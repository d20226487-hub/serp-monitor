"""Proxy Checker: hand it the project's own domains that the SERP checks found.

User, 2026-10-05: "We will send our domains (specified in the project and found
in the SERPs during checks) to the Proxy Checker … GEO is taken from the job's
GEO, domains are taken from the SERPs", and on WHEN: "let the user specify this
on the project page".

One request per country — or, for a country with more than
DOMAINS_PER_REQUEST domains, several, one after another:

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
  proxy_checker_time (UTC, HH:MM), everything found in the last 24 hours; or
  "inherit" — whatever the global switch in Settings → Tools Connection says
  (user, 2026-10-14: "one setting for auto sending block checks to the proxy
  checker after CSV file upload or serp checks. When enabled, this will happen
  automatically, when disabled the user will configure. The user should be
  able to still overwrite this setting on the project page. But default will
  be auto checks"). The switch is on unless turned off, and on it means
  "after_run"; off means nothing is sent on its own. New projects inherit;
  the projects that existed when it was added kept their "off" (the user's
  choice). A "Send now" on the project page sends the last 24 hours at any
  time, whatever the mode.
* Every request made is kept in tool_deliveries: what went, where, and what
  came back — an integration that fails silently is worse than none. Each
  country's request and answer are saved as soon as that country is done:
  a send can take minutes per country, and an app stopped half-way must not
  lose the answers it already has.
* A send runs to its end on the server whoever is still waiting for it — a
  page refreshed after "Send now" does not stop it. While it runs it is in
  `in_progress` (this process's memory: a restart ends the send as well), so
  the page can say so after a refresh, and a second press for the same
  project is refused (Busy) instead of sending everything twice (user,
  2026-10-26, on what a refresh does: "yes, do all three"). Kept in
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
domain rides with the domain that was shown.

And an AMP domain that a SERP of the country shows ITSELF is sent in its own
right, whether or not its main domain is on that page (the user, asked whether
it should be, 2026-10-13: "Yes, send them and show in Blocks"). Today's or an
earlier day's: a page can still list the host the rotator has moved on from,
and that is the one a visitor clicks — so the hosts looked for are every one a
rotator has ever named (amp_rotator.amp_hosts), as on the positions tables.
An AMP domain neither shown nor riding with a shown domain is not sent for
that country. Nothing has to be switched on: a project without a rotator
simply has no AMP domains.

Checking without a SERP (user, 2026-10-26: "check the domains for blocks even
when the SERP was not checked … let the user select which domains to check in
a specified interval (they can select or choose all). The GEOs will be taken
from the Project GEOs if specified"). Apart from everything above, a project
can send chosen domains of its own — or all of them — every N hours, for the
chosen GEOs of the project — or all of them (project_geos: the list set on its
page, the jobs' countries until it is; user, 2026-10-26: "Let the user choose
GEOs as well") — whether or not any SERP showed them. Each domain's AMP domain of
the day rides along, as it does with a found one. See direct_to_send; the
timer is the project's own (scheduler.upsert_direct_check_schedule). "Check now"
on the same card sends the domains picked there once, timer or not (user,
2026-10-26, on a one-time check: "I meant check now").

The connection (URL, token) is global: Settings → Tools Connection. The token
is stored like the SERP providers' and never returned to the browser. No
address is built in: the Proxy Checker is somebody's own service, so both are
entered there, and until both are nothing is sent.
"""
from __future__ import annotations

import itertools
import json
import logging
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Iterator, NamedTuple

import httpx
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ._redact import redact
from .amp_rotator import amp_hosts
from .app_settings import _get, _get_int, _set, _set_int
from .db import SessionLocal
from .models import (
    AmpDomain, DomainProxyCheckLog, Job, JobRun, Project, Result, ToolDelivery,
)
from .positions_csv import counted_host, ours_index

log = logging.getLogger(__name__)

TOOL = "proxy_checker"
KEY_URL = "proxy_checker_url"
KEY_TOKEN = "proxy_checker_token"
MODES = ("inherit", "off", "after_run", "daily")
#: The global switch a project on "inherit" follows. Not saved = on.
KEY_AUTO = "proxy_checker_auto_after_run"
#: "Send now" and the daily send look this far back.
WINDOW_HOURS = 24
#: SQLite's oldest builds allow 999 bound values in one statement.
_HOSTS_PER_QUERY = 400
#: Stands where the token was, in everything that is stored or shown.
TOKEN_MARK = "<token>"
_MASKABLE = 8
#: How long an answer is waited for, in minutes — a setting (Settings → Tools
#: Connection; the user, 2026-10-14: "Make it configurable in the setting: how
#: long will we wait for the proxy checker"). The Proxy Checker runs its check
#: through the country's proxies BEFORE it answers, so a request with more
#: domains takes longer: the first two real requests that got through
#: (2026-10-13, 3 domains each) had no answer after 30 seconds (ReadTimeout).
KEY_TIMEOUT = "proxy_checker_timeout_minutes"
DEFAULT_TIMEOUT_MINUTES = 5
TIMEOUT_MINUTES_MIN, TIMEOUT_MINUTES_MAX = 1, 60
#: Merely connecting has a short limit of its own, so an unreachable server is
#: still reported quickly however long an answer may take.
CONNECT_SECONDS = 15.0
#: At most this many domains in one request (user, 2026-10-26: "make the
#: request contain 3 domains per GEO. The timeout example had 8 domains in
#: it"). The Proxy Checker checks every domain through every proxy of the
#: country before it answers, and the proxy in front of it (Cloudflare) gives
#: up after 120 seconds with its own 524 — however long KEY_TIMEOUT would
#: wait. So a country's domains go out in requests this small, one after
#: another; each request's duration is kept to show how close they come.
DOMAINS_PER_REQUEST = 3
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


def timeout_minutes() -> int:
    """How long an answer is waited for, in minutes."""
    return _get_int(KEY_TIMEOUT, DEFAULT_TIMEOUT_MINUTES, TIMEOUT_MINUTES_MIN, TIMEOUT_MINUTES_MAX)


def set_timeout_minutes(minutes: int) -> int:
    return _set_int(KEY_TIMEOUT, minutes, DEFAULT_TIMEOUT_MINUTES, TIMEOUT_MINUTES_MIN, TIMEOUT_MINUTES_MAX)


def request_timeout(minutes: int) -> httpx.Timeout:
    """The whole wait for an answer, with connecting limited apart."""
    return httpx.Timeout(minutes * 60.0, connect=CONNECT_SECONDS)


def parse_flag(value: str | None, default: bool = True) -> bool:
    """A stored on/off setting. Nothing stored is the default."""
    if value is None or not value.strip():
        return default
    return value.strip().lower() not in ("0", "false", "off", "no")


def auto_after_run() -> bool:
    """The global switch: send after every SERP check and CSV upload, for the
    projects that follow it. On unless turned off."""
    db = SessionLocal()
    try:
        return parse_flag(_get(db, KEY_AUTO))
    finally:
        db.close()


def set_auto_after_run(on: bool) -> None:
    db = SessionLocal()
    try:
        _set(db, KEY_AUTO, "1" if on else "0")
    finally:
        db.close()


def effective_mode(mode: str | None, auto: bool) -> str:
    """What a project's mode comes to: "inherit" follows the global switch —
    "after_run" while it is on, "off" while it is off. Anything unknown is
    "off": a value nobody understands must not send."""
    if mode == "inherit":
        return "after_run" if auto else "off"
    return mode if mode in ("off", "after_run", "daily") else "off"


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

def group_found(rows: list[tuple], domains: list[str], amp: dict[str, str] | None = None) -> dict[str, list[str]]:
    """Country → what of the project's was found there: its domains, sorted,
    then the AMP domains found there themselves, sorted.

    `rows` are (country_code, linked_host, shown_host, job_prefers_shown) for
    captured results. A result counts as the host the positions tables count
    it as, and matches a project domain exactly or as its www. spelling — a
    subdomain is a different target, which is why projects list them apart.
    `amp` (AMP host → project domain) are the AMP domains a rotator has named
    for the project: matched by the same rule, and reported under their own
    name, since that is the host to check.
    """
    whose_host = ours_index(domains, amp)
    sites: dict[str, set[str]] = {}
    amp_found: dict[str, set[str]] = {}
    for country, linked, shown, prefers_shown in rows:
        geo = (country or "").strip().upper()
        whose = whose_host.get(counted_host(linked, shown, bool(prefers_shown)).lower())
        if not geo or whose is None:
            continue
        if whose.amp_host:
            amp_found.setdefault(geo, set()).add(whose.amp_host)
        else:
            sites.setdefault(geo, set()).add(whose.domain)
    return {geo: sorted(sites.get(geo, ())) + sorted(amp_found.get(geo, ()))
            for geo in sorted(set(sites) | set(amp_found))}


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


def batches(domains: list[str], size: int = DOMAINS_PER_REQUEST) -> list[list[str]]:
    """The domains of one country, in requests of at most `size`, in order."""
    return [list(domains[i:i + size]) for i in range(0, len(domains), size)]


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
    in every run of the project since `since` (naive UTC, as runs are stored) —
    and, after them, the AMP domains those checks captured themselves.

    "Since" is when a run started or, for an uploaded one, when it was
    uploaded: an export of last week's SERPs uploaded an hour ago is an hour
    old to the Proxy Checker, which is asked whether those domains open NOW."""
    domains = [d for d in (project.domains or []) if d]
    if not domains:
        return {}
    amp = amp_hosts(db, project)
    hosts = list(ours_index(domains, amp))
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
    return group_found(rows, domains, amp)


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


def amp_parents(db: Session, project: Project) -> dict[str, str]:
    """AMP host → the project domain it is the AMP domain of, for every AMP
    host a send can carry: today's, and the earlier ones a SERP may still
    show. What marks a domain as an AMP domain in a request, in the log and on
    the page."""
    today = {host: domain for domain, hosts in amp_of(db, project.id).items() for host in hosts}
    return {**today, **amp_hosts(db, project)}


def to_send(db: Session, project: Project, *, run_id: int | None = None,
            since: datetime | None = None, geos: list[str] | None = None) -> dict[str, list[str]]:
    """What a send carries, by country, in the countries given (default: the
    ones chosen for sending): the project's domains found in the SERPs, the
    AMP domains found there themselves, and the AMP domain of the day of each
    found domain — once each."""
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
    seconds: float | None = None  # how long it took, to the answer or the failure


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
             client: httpx.Client | None = None, *, wait_minutes: int = DEFAULT_TIMEOUT_MINUTES) -> Sent:
    """One request, and everything about it worth keeping. Never raises: a
    failed request is an outcome to record, not a reason to fail the run that
    triggered it. The token is in the request that goes out and nowhere in
    what comes back from here — not even if the server echoes it.
    `wait_minutes`: how long the answer is waited for (the caller reads the
    setting: nothing here touches the database)."""
    body = request_body(geo, domains)
    headers = request_headers(token)
    # Kept with the mark where the token goes, by construction rather than by
    # searching the header values for it.
    request = {"method": "POST", "url": url, "body": body,
               "headers": [list(h) for h in request_headers(TOKEN_MARK)]}
    own = client is None
    client = client or httpx.Client(timeout=request_timeout(wait_minutes))
    started = time.monotonic()
    try:
        r = client.post(url, content=body.encode("utf-8"), headers=dict(headers))
        try:
            data = r.json()
        except ValueError:
            data = None
        return Sent(200 <= r.status_code < 300, r.status_code,
                    _mask(redact(r.text or ""), token)[:300], request, raw_response(r, token), data,
                    time.monotonic() - started)
    except httpx.ReadTimeout as e:
        # Connected, asked, and no answer came in time: say how long that was,
        # since it is a setting and the likely thing to change.
        error = _mask(redact(f"no answer within {wait_minutes} min (ReadTimeout: {e})"), token)
        return Sent(False, None, error[:300], request, error[:RAW_BODY_LIMIT], None, time.monotonic() - started)
    except (httpx.HTTPError, httpx.InvalidURL) as e:
        error = _mask(redact(f"{type(e).__name__}: {e}"), token)
        return Sent(False, None, error[:300], request, error[:RAW_BODY_LIMIT], None, time.monotonic() - started)
    finally:
        if own:
            client.close()


class Busy(Exception):
    """A send for this project is already running."""


#: The sends running now, by a number of their own: {"project_id", "trigger",
#: "started_at" (naive UTC), "geos", "requests", "done"}.
_RUNNING: dict[int, dict] = {}
_RUNNING_LOCK = threading.Lock()
_NUMBERS = itertools.count(1)


@contextmanager
def _sending(project_id: int, trigger: str, geos: list[str], *, exclusive: bool,
             requests: int | None = None) -> Iterator[dict]:
    """Mark a send of the project as running for as long as it runs: to
    `geos`, in `requests` requests (default one per GEO).
    `exclusive`: refuse (Busy) if one of the project's is running already."""
    with _RUNNING_LOCK:
        if exclusive and any(e["project_id"] == project_id for e in _RUNNING.values()):
            raise Busy(project_id)
        number = next(_NUMBERS)
        entry = {"project_id": project_id, "trigger": trigger, "geos": list(geos), "done": 0,
                 "requests": len(geos) if requests is None else requests,
                 "started_at": datetime.now(timezone.utc).replace(tzinfo=None)}
        _RUNNING[number] = entry
    try:
        yield entry
    finally:
        with _RUNNING_LOCK:
            _RUNNING.pop(number, None)


def in_progress(project_id: int) -> list[dict]:
    """The project's sends running now, oldest first: {"trigger", "started_at",
    "geos", "requests", "done"} — `done` = how many of the requests are
    finished (and saved)."""
    with _RUNNING_LOCK:
        entries = [dict(e) for _, e in sorted(_RUNNING.items()) if e["project_id"] == project_id]
    return [{k: e[k] for k in ("trigger", "started_at", "geos", "requests", "done")} for e in entries]


def deliver(db: Session, project: Project, by_geo: dict[str, list[str]], *, trigger: str,
            run_id: int | None = None, client: httpx.Client | None = None,
            exclusive: bool = False) -> list[ToolDelivery]:
    """Each country's domains in requests of at most DOMAINS_PER_REQUEST, one
    after another, each recorded — and saved — as soon as its answer is in.
    Nothing is sent, and nothing recorded, when the connection is incomplete
    (no address or no token) or nothing was found.
    `exclusive`: refuse (Busy) while another send of the project is running —
    a press of a button; the automatic sends are never refused."""
    conn = connection()
    if not conn["url"] or not conn["token"] or not by_geo:
        return []
    # Which of the domains going out are AMP domains, and of what: the same
    # mappings that put them in the list a moment ago.
    parents = amp_parents(db, project)
    wait = timeout_minutes()
    out = []
    requests = [(geo, part) for geo, domains in by_geo.items() for part in batches(domains)]
    with _sending(project.id, trigger, list(by_geo), requests=len(requests), exclusive=exclusive) as progress:
        for geo, domains in requests:
            sent = send_one(conn["url"], conn["token"], geo, domains, client, wait_minutes=wait)
            row = ToolDelivery(tool=TOOL, project_id=project.id, run_id=run_id, trigger=trigger, geo=geo,
                               domains=domains, ok=sent.ok, status_code=sent.status_code, response=sent.excerpt,
                               request=sent.request, response_raw=sent.raw,
                               duration_ms=None if sent.seconds is None else round(sent.seconds * 1000))
            db.add(row)
            out.append(row)
            if sent.ok and sent.data is not None:
                db.flush()               # the row's id, for the statuses to point back at
                record_statuses(db, geo, domains, sent.data, row.id, project_id=project.id,
                                amp_parents={d: parents[d] for d in domains if d in parents})
            if not sent.ok:
                log.warning("proxy checker refused %s for project %s: %s %s",
                            geo, project.id, sent.status_code, sent.excerpt[:120])
            # This request is done: saved now, not when the last one is.
            db.commit()
            progress["done"] += 1
    return out


def after_run(run_id: int) -> None:
    """Called when ANY run ends (tasks.run_job_async, and the importer of the
    own-browser runs). Sends only for a project whose mode comes to
    "after_run" — set so, or following the global switch while it is on. Swallows
    everything: the check that just finished must not fail on its messenger."""
    db = SessionLocal()
    try:
        run = db.get(JobRun, run_id)
        job = db.get(Job, run.job_id) if run else None
        project = db.get(Project, job.project_id) if job and job.project_id else None
        if project is None or effective_mode(project.proxy_checker_mode, auto_after_run()) != "after_run":
            return
        deliver(db, project, to_send(db, project, run_id=run_id), trigger="after_run", run_id=run_id)
    except Exception:  # noqa: BLE001
        log.exception("proxy checker: sending after run %s failed", run_id)
    finally:
        db.close()


def send_recent(project_id: int, trigger: str, *, exclusive: bool = False) -> list[ToolDelivery]:
    """Everything the project's checks found in the last WINDOW_HOURS — the
    daily send and the project page's "Send now" (`exclusive`: see deliver)."""
    db = SessionLocal()
    try:
        project = db.get(Project, project_id)
        if project is None:
            return []
        rows = deliver(db, project, to_send(db, project, since=recent_window()), trigger=trigger,
                       exclusive=exclusive)
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


# --------------------------------------------------------------------------
# Checking without a SERP
# --------------------------------------------------------------------------

#: Every how many hours a project's chosen domains can be checked.
DIRECT_HOURS = (1, 2, 3, 4, 6, 8, 12, 24, 48, 72, 168)
DEFAULT_DIRECT_HOURS = 24
#: How these sends are marked in tool_deliveries: by the timer, or by hand.
DIRECT_TRIGGERS = ("direct", "direct_manual")


def direct_domains(project_domains: list[str], chosen: list[str] | None) -> list[str]:
    """The domains checked without a SERP, in the project's order. `None` = no
    choice was made: all of them, also ones added later. A chosen domain the
    project no longer has is not checked."""
    domains = [d for d in project_domains or [] if d]
    if chosen is None:
        return domains
    wanted = {str(c or "").strip().lower() for c in chosen}
    return [d for d in domains if d.lower() in wanted]


def direct_by_geo(domains: list[str], geos: list[str], amp: dict[str, list[str]]) -> dict[str, list[str]]:
    """Each GEO gets every domain, followed by their AMP domains of the day —
    the same order a SERP-based send has. Nothing to send without both."""
    if not domains:
        return {}
    return add_amp({geo: list(domains) for geo in geos}, amp)


def direct_to_send(db: Session, project: Project, domains: list[str] | None = ...,
                   geos: list[str] | None = ...) -> dict[str, list[str]]:
    """What a check without a SERP carries, by country: the domains and GEOs
    chosen for the timer, or — given — these (`None` = all of them)."""
    if domains is ...:
        domains = project.direct_check_domains
    if geos is ...:
        geos = project.direct_check_geos
    return direct_by_geo(direct_domains(project.domains or [], domains),
                         geos_to_send(project_geos(db, project), geos), amp_of(db, project.id))


def direct_check(project_id: int, trigger: str = "direct", domains: list[str] | None = ...,
                 geos: list[str] | None = ..., *, exclusive: bool = False) -> list[ToolDelivery]:
    """Send the project's chosen domains for its chosen GEOs now — the timer's
    choice, or the ones given ("Check now" sends what the page shows).
    `exclusive`: see deliver."""
    db = SessionLocal()
    try:
        project = db.get(Project, project_id)
        if project is None:
            return []
        rows = deliver(db, project, direct_to_send(db, project, domains, geos), trigger=trigger,
                       exclusive=exclusive)
        for r in rows:
            db.refresh(r)
            db.expunge(r)
        return rows
    finally:
        db.close()


def direct_check_tick(project_id: int) -> None:
    """The timer's callable (top-level, so the job store can pickle it). A
    project switched off since its timer was set sends nothing."""
    db = SessionLocal()
    try:
        project = db.get(Project, project_id)
        on = project is not None and bool(project.direct_check_enabled)
    finally:
        db.close()
    if not on:
        return
    try:
        direct_check(project_id, "direct")
    except Exception:  # noqa: BLE001
        log.exception("proxy checker: check without a SERP for project %s failed", project_id)
