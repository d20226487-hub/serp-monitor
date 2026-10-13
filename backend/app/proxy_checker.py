"""Proxy Checker: hand it the project's own domains that the SERP checks found.

User, 2026-10-05: "We will send our domains (specified in the project and found
in the SERPs during checks) to the Proxy Checker … GEO is taken from the job's
GEO, domains are taken from the SERPs", and on WHEN: "let the user specify this
on the project page".

One request per country:

    POST <url>                      Authorization: Bearer <token>
    {"DailyCheck": {"geo": "KG", "domains": ["lucky-zazino.pro", …]}}

* "Our domains found in the SERPs" is the same question the positions tables
  answer, by the same rule (positions_csv.counted_host / the project domain or
  its www. spelling): a domain is sent for a country only if a check in that
  country actually captured it. A project domain that ranks nowhere is not sent.
* GEO is the result's country code, upper-cased. A check with no location has
  no country, and is not sent anywhere.
* Which GEOs: the project has a list of its GEOs (Project.geos, set on the
  project page — until it is, the countries its jobs check stand in), and of
  those the user picks whose findings go to the Proxy Checker
  (Project.proxy_checker_geos; unset = all of them). A country outside both is
  never sent, however many of our domains its SERPs showed.
* When, per project (Project.proxy_checker_mode): "off"; "after_run" — what
  each finished run found, straight after it (an uploaded CSV is a run: "the
  CSV upload will equal прогон"); "daily" — once a day at
  proxy_checker_time (UTC, HH:MM), everything found in the last 24 hours. A
  "Send now" on the project page sends the last 24 hours at any time.
* Every request made is kept in tool_deliveries: what went, where, and what
  came back — an integration that fails silently is worse than none. Kept in
  full: the request as it went out (shown as a curl command, the token
  replaced by a mark) and the answer as it was received — status line,
  headers, body. "Refused, HTTP 403" alone cannot be acted on; the headers
  usually say who refused.

Assumed, not known (the API's behaviour could only be probed without a token:
403 on GET and POST): each request stands alone, so two projects sending for
the same country do not overwrite one another; and any 2xx means accepted.

What an accepted answer says (the user's example, 2026-10-06 — no live answer
had been received yet, every request from here being refused with 403):

    {"example1.com": {"KG - Provider A": "PASS", "KG - Provider B": "PASS", …}, …}

One entry per domain, and in it one status per PROXY — several per country,
named by the Proxy Checker. `read_answer` takes that apart and
`record_statuses` keeps every answer per (country, domain) for the Blocks tab, which
shows each proxy's status as given: the user, on a first table that reduced
this to blocked / not blocked — "we do not show blocked or not blocked we
display the status by each proxy". "PASS" is the only status seen so far; what
else a proxy can say is the Proxy Checker's vocabulary, kept verbatim.

AMP domains (user, 2026-10-13: "if the project has specified AMP endpoints, if
applicable, the AMP domains will be sent to the Proxy Checker"). A project with
an AMP Rotator has, for some of its domains, an AMP domain of the day — the
host a visitor coming from the SERP actually lands on. So for each country,
every domain found there is followed by ITS AMP domain (amp_of / add_amp): the
rule for what goes stays "what the SERPs of that country showed", and the AMP
domain rides with the domain that was shown. An AMP domain whose main domain
was not found in a country is not sent for it. Nothing has to be switched on:
a project without a rotator simply has no AMP domains to add.

The connection (URL, token) is global: Settings → Tools Connection. The token
is stored like the SERP providers' and never returned to the browser. No
address is built in: the Proxy Checker is somebody's own service, so both are
entered there, and until both are nothing is sent.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import NamedTuple

import httpx
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ._redact import redact
from .app_settings import _get, _set
from .db import SessionLocal
from .models import (
    AmpDomain, DomainProxyCheckLog, Job, JobRun, Project, Result, ToolDelivery,
)
from .positions_csv import counted_host

log = logging.getLogger(__name__)

TOOL = "proxy_checker"
KEY_URL = "proxy_checker_url"
KEY_TOKEN = "proxy_checker_token"
MODES = ("off", "after_run", "daily")
#: "Send now" and the daily send look this far back.
WINDOW_HOURS = 24
#: SQLite's oldest builds allow 999 bound values in one statement.
_HOSTS_PER_QUERY = 400
#: Stands where the token was, in everything that is stored or shown.
TOKEN_MARK = "<token>"
_MASKABLE = 8
#: How long an answer is waited for. The Proxy Checker runs its check through
#: the country's proxies BEFORE it answers: the first two real requests that
#: got through (2026-10-13, 3 domains each) had no answer after 30 seconds
#: (ReadTimeout). Five minutes, with a short limit on merely connecting so an
#: unreachable server is still reported quickly.
TIMEOUT = httpx.Timeout(300.0, connect=15.0)
#: How much of an answer's body is kept. A JSON reply or a firewall's error
#: page fits many times over; one that does not is cut, and says so.
RAW_BODY_LIMIT = 20_000


# --------------------------------------------------------------------------
# Connection (global)
# --------------------------------------------------------------------------

def connection() -> dict:
    """{"url", "token"} — the real token; for the sender only."""
    db = SessionLocal()
    try:
        return {"url": (_get(db, KEY_URL) or "").strip(), "token": (_get(db, KEY_TOKEN) or "").strip()}
    finally:
        db.close()


def set_connection(*, url: str | None = None, token: str | None = None) -> None:
    """Only what is given changes; an empty string clears that field."""
    db = SessionLocal()
    try:
        if url is not None:
            _set(db, KEY_URL, url.strip() or None)
        if token is not None:
            _set(db, KEY_TOKEN, token.strip() or None)
    finally:
        db.close()


def connection_status() -> dict:
    """What the browser may see: never the token itself. `connected` = there
    is both an address and a token, i.e. something can be sent."""
    c = connection()
    token = c["token"]
    return {
        "url": c["url"], "connected": bool(c["url"] and token),
        "token": {"configured": True, "last4": token[-4:], "length": len(token)} if token else {"configured": False},
    }


# --------------------------------------------------------------------------
# Pure: what to send
# --------------------------------------------------------------------------

def group_found(rows: list[tuple], domains: list[str]) -> dict[str, list[str]]:
    """Country → the project's domains found there, sorted.

    `rows` are (country_code, linked_host, shown_host, job_prefers_shown) for
    captured results. A result counts as the host the positions tables count
    it as, and matches a project domain exactly or as its www. spelling — a
    subdomain is a different target, which is why projects list them apart.
    """
    by_host = {h: d for d in domains for h in (d.lower(), f"www.{d.lower()}")}
    found: dict[str, set[str]] = {}
    for country, linked, shown, prefers_shown in rows:
        geo = (country or "").strip().upper()
        domain = by_host.get(counted_host(linked, shown, bool(prefers_shown)).lower())
        if geo and domain:
            found.setdefault(geo, set()).add(domain)
    return {geo: sorted(ds) for geo, ds in sorted(found.items())}


def clean_geos(values) -> list[str]:
    """ISO country codes as stored and sent: upper-case, two letters, once
    each, in the order given. Anything else is dropped rather than guessed at."""
    out: list[str] = []
    for v in values or []:
        code = str(v or "").strip().upper()
        if len(code) == 2 and code.isalpha() and code not in out:
            out.append(code)
    return out


def geos_to_send(project_geos: list[str], chosen: list[str] | None) -> list[str]:
    """The countries whose findings go out: the project's GEOs, narrowed to
    the ones chosen for the Proxy Checker. `None` = no choice was made, so all
    of the project's GEOs — also the ones added to it tomorrow. A chosen
    country that is no longer one of the project's is not sent."""
    if chosen is None:
        return list(project_geos)
    return [g for g in project_geos if g in set(clean_geos(chosen))]


def keep_geos(by_geo: dict[str, list[str]], allowed: list[str]) -> dict[str, list[str]]:
    return {geo: domains for geo, domains in by_geo.items() if geo in set(allowed)}


def add_amp(by_geo: dict[str, list[str]], amp: dict[str, list[str]]) -> dict[str, list[str]]:
    """Each country's domains, followed by the AMP domains of those domains.

    `amp` maps a domain to its AMP domain(s) of the day. Only the domains
    found in a country bring their AMP domains along, once each, after the
    found ones — so a request reads "what was shown, then where it leads".
    """
    out: dict[str, list[str]] = {}
    for geo, domains in by_geo.items():
        extra: list[str] = []
        for domain in domains:
            for host in amp.get(domain, []):
                if host not in domains and host not in extra:
                    extra.append(host)
        out[geo] = list(domains) + extra
    return out


def build_payload(geo: str, domains: list[str]) -> dict:
    return {"DailyCheck": {"geo": geo, "domains": list(domains)}}


def request_body(geo: str, domains: list[str]) -> str:
    """The body exactly as it goes on the wire. One string for the request and
    for the curl shown afterwards, so the two cannot differ."""
    return json.dumps(build_payload(geo, domains), ensure_ascii=False, separators=(",", ":"))


def request_headers(token: str) -> list[tuple[str, str]]:
    """Every header we choose. The User-Agent is the HTTP library's own,
    spelled out so that the curl sends the same one: a server that treats
    clients differently must see the same client both times."""
    return [
        ("Authorization", f"Bearer {token}"),
        ("Accept", "application/json"),
        ("Content-Type", "application/json"),
        ("User-Agent", f"python-httpx/{httpx.__version__}"),
    ]


def _mask(text: str, token: str) -> str:
    """`text` with the token taken out, wherever a server put it. A token too
    short to be told from ordinary text is left alone: replacing every "t"
    would destroy the answer and protect nothing."""
    return text.replace(token, TOKEN_MARK) if len(token) >= _MASKABLE else text


def _quoted(arg: str) -> str:
    """One double-quoted argument that both bash/zsh and Windows cmd pass to
    curl as written (single quotes, the usual bash form, mean nothing to cmd).
    `$` and the backtick are escaped for bash only — cmd would pass that
    backslash on — but neither occurs in a hostname or in this API's address."""
    for ch in ("\\", '"', "$", "`"):
        arg = arg.replace(ch, "\\" + ch)
    return f'"{arg}"'


def curl_command(request: dict | None) -> str | None:
    """A stored request as a curl command, on one line (a continuation is
    spelled differently in each shell). `-i` prints the answer's status line
    and headers too — the form the stored answer is shown in."""
    if not request or not request.get("url"):
        return None
    parts = ["curl", "-i", "-X", request.get("method") or "POST", _quoted(request["url"])]
    for name, value in request.get("headers") or []:
        parts += ["-H", _quoted(f"{name}: {value}")]
    if request.get("body") is not None:
        parts += ["-d", _quoted(request["body"])]
    return " ".join(parts)


def raw_response(r: httpx.Response, token: str) -> str:
    """The answer as received: status line, headers, blank line, body."""
    head = [f"{r.http_version} {r.status_code} {r.reason_phrase}".rstrip()]
    head += [f"{name}: {value}" for name, value in r.headers.multi_items()]
    body = r.text or ""
    if len(body) > RAW_BODY_LIMIT:
        body = body[:RAW_BODY_LIMIT] + f"\n[… {len(body) - RAW_BODY_LIMIT} more characters not kept]"
    return _mask("\n".join(head) + "\n\n" + body, token)


def valid_time(value: str | None) -> bool:
    """HH:MM, 24-hour."""
    try:
        return bool(value) and datetime.strptime(value, "%H:%M").strftime("%H:%M") == value
    except ValueError:
        return False


# --------------------------------------------------------------------------
# Loading and sending
# --------------------------------------------------------------------------

def job_countries(db: Session, project_id: int) -> list[str]:
    """The countries the project's jobs check, from their locations."""
    codes: list[str] = []
    for (locations,) in db.query(Job.locations).filter(Job.project_id == project_id).all():
        codes += [(loc or {}).get("country_code") for loc in (locations or []) if isinstance(loc, dict)]
    return sorted(clean_geos(codes))


def project_geos(db: Session, project: Project) -> list[str]:
    """The project's GEOs: the list set on its page, or — never set — the
    countries its jobs check, so a project nobody configured behaves as before."""
    if project.geos is not None:
        return clean_geos(project.geos)
    return job_countries(db, project.id)


def send_geos(db: Session, project: Project) -> list[str]:
    return geos_to_send(project_geos(db, project), project.proxy_checker_geos)


def found_by_geo(db: Session, project: Project, *, run_id: int | None = None,
                 since: datetime | None = None) -> dict[str, list[str]]:
    """The project's domains its checks captured, by country — in one run, or
    in every run of the project since `since` (naive UTC, as runs are stored).

    "Since" is when a run started or, for an uploaded one, when it was
    uploaded: an export of last week's SERPs uploaded an hour ago is an hour
    old to the Proxy Checker, which is asked whether those domains open NOW."""
    domains = [d for d in (project.domains or []) if d]
    if not domains:
        return {}
    hosts = [h for d in domains for h in (d, f"www.{d}")]
    rows: list[tuple] = []
    for i in range(0, len(hosts), _HOSTS_PER_QUERY):
        part = hosts[i:i + _HOSTS_PER_QUERY]
        q = (
            db.query(Result.country_code, Result.domain, Result.shown_host, Job.prefer_shown_host)
            .join(JobRun, JobRun.id == Result.run_id)
            .join(Job, Job.id == JobRun.job_id)
            .filter(Job.project_id == project.id,
                    or_(Result.domain.in_(part), Result.shown_host.in_(part)))
        )
        if run_id is not None:
            q = q.filter(Result.run_id == run_id)
        if since is not None:
            q = q.filter(or_(JobRun.started_at >= since, JobRun.uploaded_at >= since))
        rows += [tuple(r) for r in q.distinct().all()]
    return group_found(rows, domains)


def amp_of(db: Session, project_id: int) -> dict[str, list[str]]:
    """Domain → its AMP domain(s) today, as the project's AMP Rotators last
    answered. Usually one; two rotators naming the same site give two."""
    out: dict[str, list[str]] = {}
    rows = (db.query(AmpDomain.domain, AmpDomain.amp_domain)
            .filter(AmpDomain.project_id == project_id)
            .order_by(AmpDomain.domain, AmpDomain.id).all())
    for domain, host in rows:
        if host not in out.setdefault(domain, []):
            out[domain].append(host)
    return out


def to_send(db: Session, project: Project, *, run_id: int | None = None,
            since: datetime | None = None, geos: list[str] | None = None) -> dict[str, list[str]]:
    """What a send carries, by country: the project's domains found in the
    SERPs, in the countries given (default: the ones chosen for sending), each
    followed by its AMP domain of the day."""
    found = found_by_geo(db, project, run_id=run_id, since=since)
    allowed = send_geos(db, project) if geos is None else geos
    return add_amp(keep_geos(found, allowed), amp_of(db, project.id))


def recent_window() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=WINDOW_HOURS)


class Sent(NamedTuple):
    ok: bool
    status_code: int | None      # None = no HTTP answer at all
    excerpt: str                 # the start of the answer, for the log's one line
    request: dict                # as it went out, the token replaced by TOKEN_MARK
    raw: str                     # the answer as received, or the transport's error
    data: object = None          # the answer's JSON, when it was JSON


def read_answer(data: object, sent: list[str]) -> dict[str, dict[str, str]]:
    """Domain → {proxy: status}, from an answer shaped as the module docstring
    shows. Proxy names and statuses are kept exactly as given (trimmed).

    A domain that was not in the request is not believed, so an answer about
    something else cannot be pinned on ours; and an entry that is not a
    proxy → status mapping is left out rather than guessed at.
    """
    if not isinstance(data, dict):
        return {}
    wanted = {d.lower(): d for d in sent}
    found: dict[str, dict[str, str]] = {}
    for name, proxies in data.items():
        domain = wanted.get(str(name).strip().lower())
        if domain is None or not isinstance(proxies, dict):
            continue
        statuses = {
            str(proxy).strip(): str(status).strip()
            for proxy, status in proxies.items()
            if isinstance(status, (str, int, float, bool)) and str(proxy).strip() and str(status).strip()
        }
        if statuses:
            found[domain] = statuses
    return found


def record_statuses(db: Session, geo: str, sent: list[str], data: object, delivery_id: int | None, *,
                    project_id: int | None = None, amp_parents: dict[str, str] | None = None) -> int:
    """Keep what an answer said about the domains it was asked about: a line
    per domain in the log, so that "what did not pass on the 10th" still has
    an answer on the 13th.

    `amp_parents` maps each AMP domain in this request to the project domain
    it was the AMP domain of — recorded with the line, because tomorrow that
    AMP domain belongs to nothing. Not committed here."""
    answered = read_answer(data, sent)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for domain, statuses in answered.items():
        db.add(DomainProxyCheckLog(
            project_id=project_id, geo=geo, domain=domain, main_domain=(amp_parents or {}).get(domain),
            statuses=statuses, checked_at=now, delivery_id=delivery_id))
    return len(answered)


def send_one(url: str, token: str, geo: str, domains: list[str],
             client: httpx.Client | None = None) -> Sent:
    """One request, and everything about it worth keeping. Never raises: a
    failed request is an outcome to record, not a reason to fail the run that
    triggered it. The token is in the request that goes out and nowhere in
    what comes back from here — not even if the server echoes it."""
    body = request_body(geo, domains)
    headers = request_headers(token)
    # Kept with the mark where the token goes, by construction rather than by
    # searching the header values for it.
    request = {"method": "POST", "url": url, "body": body,
               "headers": [list(h) for h in request_headers(TOKEN_MARK)]}
    own = client is None
    client = client or httpx.Client(timeout=TIMEOUT)
    try:
        r = client.post(url, content=body.encode("utf-8"), headers=dict(headers))
        try:
            data = r.json()
        except ValueError:
            data = None
        return Sent(200 <= r.status_code < 300, r.status_code,
                    _mask(redact(r.text or ""), token)[:300], request, raw_response(r, token), data)
    except (httpx.HTTPError, httpx.InvalidURL) as e:
        error = _mask(redact(f"{type(e).__name__}: {e}"), token)
        return Sent(False, None, error[:300], request, error[:RAW_BODY_LIMIT])
    finally:
        if own:
            client.close()


def deliver(db: Session, project: Project, by_geo: dict[str, list[str]], *, trigger: str,
            run_id: int | None = None, client: httpx.Client | None = None) -> list[ToolDelivery]:
    """One request per country, each recorded. Nothing is sent, and nothing
    recorded, when the connection is incomplete (no address or no token) or
    nothing was found."""
    conn = connection()
    if not conn["url"] or not conn["token"] or not by_geo:
        return []
    # Which of the domains going out are AMP domains, and of what: the same
    # mapping that put them in the list a moment ago.
    amp_parents = {host: domain for domain, hosts in amp_of(db, project.id).items() for host in hosts}
    out = []
    for geo, domains in by_geo.items():
        sent = send_one(conn["url"], conn["token"], geo, domains, client)
        row = ToolDelivery(tool=TOOL, project_id=project.id, run_id=run_id, trigger=trigger, geo=geo,
                           domains=domains, ok=sent.ok, status_code=sent.status_code, response=sent.excerpt,
                           request=sent.request, response_raw=sent.raw)
        db.add(row)
        out.append(row)
        if sent.ok and sent.data is not None:
            db.flush()               # the row's id, for the statuses to point back at
            record_statuses(db, geo, domains, sent.data, row.id, project_id=project.id,
                            amp_parents={d: amp_parents[d] for d in domains if d in amp_parents})
        if not sent.ok:
            log.warning("proxy checker refused %s for project %s: %s %s",
                        geo, project.id, sent.status_code, sent.excerpt[:120])
    db.commit()
    return out


def after_run(run_id: int) -> None:
    """Called when ANY run ends (tasks.run_job_async, and the importer of the
    own-browser runs). Sends only for a project set to "after_run". Swallows
    everything: the check that just finished must not fail on its messenger."""
    db = SessionLocal()
    try:
        run = db.get(JobRun, run_id)
        job = db.get(Job, run.job_id) if run else None
        project = db.get(Project, job.project_id) if job and job.project_id else None
        if project is None or project.proxy_checker_mode != "after_run":
            return
        deliver(db, project, to_send(db, project, run_id=run_id), trigger="after_run", run_id=run_id)
    except Exception:  # noqa: BLE001
        log.exception("proxy checker: sending after run %s failed", run_id)
    finally:
        db.close()


def send_recent(project_id: int, trigger: str) -> list[ToolDelivery]:
    """Everything the project's checks found in the last WINDOW_HOURS — the
    daily send and the project page's "Send now"."""
    db = SessionLocal()
    try:
        project = db.get(Project, project_id)
        if project is None:
            return []
        rows = deliver(db, project, to_send(db, project, since=recent_window()), trigger=trigger)
        for r in rows:
            db.refresh(r)
            db.expunge(r)
        return rows
    finally:
        db.close()


def daily_send(project_id: int) -> None:
    """The scheduler's callable (top-level, so the job store can pickle it)."""
    try:
        send_recent(project_id, "daily")
    except Exception:  # noqa: BLE001
        log.exception("proxy checker: daily send for project %s failed", project_id)
