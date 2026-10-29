"""Where a project's domains rank, for the keywords its jobs watch.

This is the first thing that reads Project.domains — until now they were only
stored. It answers one question: over some window of time, for each keyword we
track, what position does each of our domains hold?

Two views of the same measurements, because they answer different questions:

* ``/positions`` — where we stand NOW. Each row shows its LATEST run inside
  the window, so a newer measurement always replaces an older one; taking the
  best across the window instead would quietly hide a drop.

* ``/positions/average`` — how we have held up ACROSS the window. Each row
  averages every run of that keyword on that SERP and says how many runs it is
  averaging. One reading is a snapshot and can be a fluke; ten readings with
  their spread are a position.

* ``/positions/tracking`` — a rank tracker's view: how many of the project's
  positions are in each top N against the previous period, and a row per
  ranking URL with its best, average and readings. See the section at the end.

Decisions worth knowing, because they are what make the numbers mean something:

* Results are split into one table per SERP, and a SERP is the whole of
  (engine, device, country, language, location, google domain) — the same tuple
  the run page and the browser-URL builder treat as one variant. Every one of
  those changes the page that comes back, so two of them sharing a row would
  average positions no single page ever held. Splitting rather than adding a
  column also means each table's keyword column reads straight down.

* Runs are picked per row rather than per project, so a job that failed halfway
  only supersedes — or only contributes to — the keywords it actually reached.

* A row carries only the domains that actually RANKED, ordered by position —
  not a slot for every domain in the project. A project watching ten sites
  would otherwise be a ten-column grid that is mostly dashes, and a keyword
  where all ten rank reads better as a list in position order than as ten
  columns the eye has to reassemble.

* A domain matches a result host exactly, plus the "www." spelling of it. The
  provider writes result hosts as it finds them — 1979 of 4496 rows here carry
  a leading www. — while project domains are stored normalised. Subdomains do
  NOT match their parent: kz.example.com is a different target from
  example.com, which is exactly why the project stores them separately.

* An AMP domain counts as the project's too. A project lists its sites, not
  their AMP domains — those change daily — so every AMP host a rotator has
  named for one of the project's domains is matched by the same rule (the
  user, 2026-10-13: "we have not added the today's AMP domains to the project
  BUT they appear in SERPs. Then they should be counted in positions as
  well"). Every one EVER named, not today's: a page read last week shows last
  week's AMP host. Such a result is listed under the host that ranked, marked
  as an AMP domain of its site, and every AMP host is an entry of its own: a
  row can hold "example.com #3", today's AMP domain at #1 and yesterday's,
  still listed, at #6 — which is each a host somebody can click, and each one
  the Blocks tab has to show. Across a window the AMP hosts of one site are
  ONE line — the host is new every day, and thirty lines each present once
  would say nothing about how the site's AMP side has held up.

* Which host a result COUNTS as depends on its job's `prefer_shown_host`. With
  it on, a result the engine printed as by.tribuna.com over a cloudfront.net
  link counts as by.tribuna.com, because that is what ranked as far as anyone
  reading the page is concerned. The raw host travels alongside in every case,
  so a substitution is always visible and never destroys the measurement.
"""
from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone
from statistics import fmean
from typing import Literal, NamedTuple
from urllib.parse import urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..amp_rotator import AmpPeriod, amp_hosts, amp_periods, as_dates
from ..app_settings import get_visibility_weights
from ..db import get_db
from ..engine_domains import yandex_domain_for
from ..models import Job, JobRun, Project, Result
from ..positions_csv import Page, PageResult, counted_host, grid_rows, list_rows, ours_index, to_csv
from ..visibility import share, visibility
from .export import _slugify

router = APIRouter(prefix="/projects", tags=["projects"])

#: What makes one SERP distinct from another. Every field here changes the page
#: the engine returns, so two of them must never share a table: the same term
#: asked of google.kz in Russian from Almaty and of google.com in Kazakh from
#: Astana are two different results pages. Mirrors the tuple the run page and
#: lib/browser-urls already treat as one variant.
SERP_COLUMNS = (
    "engine", "device", "country_code", "language", "location", "google_domain",
)


# --------------------------------------------------------------------------
# Pure arithmetic. Kept apart from the queries so the part that decides what a
# number MEANS can be tested without a database behind it.
# --------------------------------------------------------------------------

class Averaged(NamedTuple):
    """One domain's record on one keyword, over a window of runs."""
    average: float
    best: int
    worst: int
    #: Runs this domain actually appeared in.
    ranked_in: int
    #: Runs that measured this keyword on this SERP at all. The gap between the
    #: two is the whole point: 3.0 across 9 of 10 runs and 3.0 across 1 of 10
    #: are not the same finding, and a mean alone cannot tell them apart.
    runs: int
    #: The same gap as a share, because it is the figure people compare across
    #: keywords. Visibility is presence, not rank: holding #3 on a third of the
    #: readings is a worse result than holding #6 on all of them, and only this
    #: pair says so.
    present_pct: float
    absent_pct: float


def average_position(positions: list[int], runs: int) -> Averaged | None:
    """Mean of the runs where the domain RANKED, plus how often that was.

    Absences are counted, never averaged in. There is no number for "was not on
    the page" — the captured depth is a property of the run, not of the domain,
    so substituting depth+1 would invent a position that changes with how deep
    we happened to scrape that day. Reporting presence separately says the same
    thing without making anything up.

    None when the domain never ranked: no positions, so no average.
    """
    if not positions:
        return None
    # A domain cannot have ranked in more runs than measured it; if coverage
    # somehow disagrees, believe the readings rather than print "4 of 3".
    total = max(runs, len(positions))
    present = round(len(positions) * 100 / total, 1)
    return Averaged(
        average=round(fmean(positions), 1),
        best=min(positions),
        worst=max(positions),
        ranked_in=len(positions),
        runs=total,
        present_pct=present,
        # Taken from the rounded share rather than computed again, so the two
        # always add up to 100 on screen instead of to 99.9.
        absent_pct=round(100 - present, 1),
    )


def mixed_providers(providers: Iterable[str | None]) -> bool:
    """True when an average would blend two providers' numbering schemes.

    DataForSEO stores rank_absolute — which counts ads and AI blocks — while
    SerpAPI stores the organic-only rank. The same slot on the same page comes
    back as #9 from one and #7 from the other, so a mean across them is a figure
    no page ever showed. Flagged rather than hidden or silently split: the
    number is still worth having, but not without knowing that.

    NULL is "we did not record it" — runs predating per-run providers — not
    "the same as the others". Unknown never counts as a second provider,
    because a mix we cannot prove is not a mix we should claim.
    """
    return len({p for p in providers if p}) > 1


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------

def _parse_stamp(value: str | None, field: str) -> datetime | None:
    """ISO-8601 in, naive UTC out.

    Run timestamps are stored naive UTC, so an aware value is converted rather
    than compared — mixing the two raises, and comparing a local wall clock
    against UTC would silently shift the window by the offset.
    """
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, f"{field} is not an ISO-8601 timestamp: {value!r}")
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


#: Hosts per IN (…): a project's domains and every AMP host ever named for
#: them can run to thousands, and each is bound twice (linked and displayed).
_HOSTS_PER_QUERY = 400


class _Window(NamedTuple):
    """Everything both views need before they diverge."""
    project: Project
    domains: list[str]
    #: AMP host → the project domain it is, or was, the AMP domain of.
    amp: dict[str, str]
    #: The same hosts, with when the rotators named them.
    amp_periods: dict[str, AmpPeriod]
    job_names: dict[int, str]
    #: Per job, not per project: two jobs in one folder can legitimately
    #: disagree about whether an AMP result counts as its publisher.
    prefers_shown: dict[int, bool]
    run_by_id: dict[int, JobRun]
    runs: list[JobRun]


def _window(db: Session, project_id: int, start: str | None, end: str | None) -> _Window:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404)

    started_from = _parse_stamp(start, "start")
    started_to = _parse_stamp(end, "end")

    job_rows = (
        db.query(Job.id, Job.name, Job.prefer_shown_host)
        .filter(Job.project_id == project_id)
        .all()
    )
    job_names = {jid: name for jid, name, _ in job_rows}

    runs_q = db.query(JobRun).filter(JobRun.job_id.in_(job_names.keys() or [-1]))
    if started_from is not None:
        runs_q = runs_q.filter(JobRun.started_at >= started_from)
    if started_to is not None:
        runs_q = runs_q.filter(JobRun.started_at < started_to)
    runs = runs_q.order_by(JobRun.started_at.desc()).all()

    periods = amp_periods(db, project)
    return _Window(
        project=project,
        domains=list(project.domains or []),
        amp={host: p.domain for host, p in periods.items()},
        amp_periods=periods,
        job_names=job_names,
        prefers_shown={jid: bool(pref) for jid, _, pref in job_rows},
        run_by_id={r.id: r for r in runs},
        runs=runs,
    )


def _coverage(db: Session, run_ids: Iterable[int]) -> list[tuple[tuple, int, int, int]]:
    """Every (keyword, SERP, run) these runs measured, how deep and how wide.

    Read from results rather than from the jobs' keyword lists, so a keyword
    added to a job after a run does not appear as a row the run never measured
    — which on the averaged view would make the denominator too large and every
    average look thinner than it is.

    The depth is the deepest position captured, which is what a slot's share of
    the page is measured against: seven results mean seven slots hold the whole
    page between them. The count is how many results were actually stored,
    which is not the same number when the provider reports rank_absolute and
    leaves holes where ads sat — it is what "we hold 3 of 8" counts against.

    Returned as (key, run_id, depth, slots) rather than a flat row so no caller
    has to know which column is which.
    """
    rows = (
        db.query(
            Result.keyword, *[getattr(Result, c) for c in SERP_COLUMNS],
            Result.run_id, func.max(Result.position), func.count(Result.id),
        )
        .filter(Result.run_id.in_(list(run_ids)))
        .group_by(
            Result.keyword, *[getattr(Result, c) for c in SERP_COLUMNS], Result.run_id,
        )
        .all()
    )
    return [(tuple(r[:-3]), r[-3], r[-2] or 0, r[-1] or 0) for r in rows]


def _whos(win: _Window) -> list[tuple[str, bool]]:
    """The lines a keyword can have in the averaged view: each project domain,
    and — as a line of its own — the AMP side of each domain a rotator has
    named AMP hosts for."""
    with_amp = set(win.amp.values())
    return [(d, False) for d in win.domains] + [(d, True) for d in win.domains if d in with_amp]


def _hits(db: Session, win: _Window, run_ids: set[int], *, with_slots: bool = False) -> dict[tuple, dict]:
    """One entry per (keyword, SERP, host, run), for the hosts that are the
    project's — `host` being (project domain, AMP host or None): the domain
    itself, or one of its AMP domains. `with_slots`: each entry also lists
    every slot as (position, url), for a view that follows URLs.

    A site can hold several slots on one page, and the two questions about that
    want different answers. `position` is the best of them — the position the
    site "has", because averaging #4, #6 and #9 would rank a site with three
    listings below one with a single #5. `positions` is all of them, because
    how much of the page a network occupies is exactly the count it holds.
    """
    cells: dict[tuple, dict] = {}
    if not win.domains or not run_ids:
        return cells

    whose_host = ours_index(win.domains, win.amp)
    wanted_hosts = list(whose_host)
    # Both hosts are candidates, so the filter cannot be a plain IN on `domain`:
    # a result whose LINK is a cloudfront host still matches when the engine
    # displayed the publisher. Asked in parts, and gathered by the result's id:
    # one whose two hosts fall in different parts comes back twice.
    found: dict[int, tuple] = {}
    for i in range(0, len(wanted_hosts), _HOSTS_PER_QUERY):
        part = wanted_hosts[i:i + _HOSTS_PER_QUERY]
        rows = (
            db.query(
                Result.id, Result.keyword, *[getattr(Result, c) for c in SERP_COLUMNS],
                Result.run_id, Result.domain, Result.position, Result.url,
                Result.shown_host,
            )
            .filter(
                Result.run_id.in_(list(run_ids)),
                or_(
                    Result.domain.in_(part),
                    Result.shown_host.in_(part),
                ),
            )
            .all()
        )
        for result_id, *rest in rows:
            found[result_id] = tuple(rest)
    for row in found.values():
        key = tuple(row[: 1 + len(SERP_COLUMNS)])
        run_id, host, position, url, displayed = row[-5:]
        linked_host = (host or "").lower()
        use_displayed = win.prefers_shown.get(win.run_by_id[run_id].job_id, False)
        # The host this result counts as. Only the displayed one when the job
        # asked for that AND the engine actually reported one.
        counted = (displayed or linked_host) if use_displayed else linked_host
        whose = whose_host.get(counted)
        if whose is None:
            continue
        made = {
            # The host that ranked, as the project knows it: one of its
            # domains, or an AMP domain of one — then `amp_of` names the site.
            "domain": whose.amp_host or whose.domain,
            "amp_of": whose.domain if whose.amp_host else None,
            # When it was the AMP domain of that site, as far as the rotators'
            # answers go: {"from", "to"}, `to` null while it still is.
            "amp_period": as_dates(win.amp_periods.get(whose.amp_host)) if whose.amp_host else None,
            "position": position,
            "url": url,
            # Raw values travel with every hit, so the table can reveal what
            # was really linked without another request.
            "linked_host": linked_host or None,
            "shown_host": displayed,
            # True when the two differ: an AMP publisher, a CDN, or a doorway
            # printing someone else's brand.
            "substituted": bool(
                displayed and linked_host and displayed != linked_host
            ),
            # The job asked for the displayed host and the engine gave none, so
            # this hit fell back to the raw link. Marked rather than left
            # looking resolved: a silent fallback is a quiet wrong answer,
            # which is worse than a visible gap.
            "unresolved": bool(use_displayed and not displayed),
        }
        cell_key = (*key, (whose.domain, whose.amp_host), run_id)
        prior = cells.get(cell_key)
        if prior is None:
            made["positions"] = [position]
            if with_slots:
                made["slots"] = [(position, url)]
            cells[cell_key] = made
        else:
            # Every slot is kept; which one supplies the headline fields —
            # the URL, the displayed host, the substitution flag — is decided
            # by the best of them, so a row describes the listing it reports.
            prior["positions"].append(position)
            if with_slots:
                prior["slots"].append((position, url))
            if position < prior["position"]:
                made["positions"] = prior["positions"]
                if with_slots:
                    made["slots"] = prior["slots"]
                cells[cell_key] = made
    for cell in cells.values():
        cell["positions"].sort()
        if with_slots:
            cell["slots"].sort()
    return cells


def _serp_shell(serp_key: tuple) -> dict:
    return {
        **dict(zip(SERP_COLUMNS, serp_key)),
        "key": "|".join("" if v is None else str(v) for v in serp_key),
        "rows": [],
    }


def _ordered(serps: dict[tuple, dict]) -> list[dict]:
    """SERPs in a fixed order — engine, then device, then place — so a project
    watching the same terms in two cities lists them the same way every visit."""
    return [
        serps[k] for k in sorted(
            serps,
            # None sorts before a string, and location is nullable.
            key=lambda t: tuple("" if v is None else str(v) for v in t),
        )
    ]


def _run_list(win: _Window) -> list[dict]:
    return [
        {
            "id": r.id, "job_id": r.job_id, "job_name": win.job_names.get(r.job_id),
            "status": r.status, "started_at": r.started_at, "provider": r.provider,
        }
        for r in win.runs
    ]


def _empty(win: _Window) -> dict:
    return {
        "project": {"id": win.project.id, "name": win.project.name, "domains": win.domains},
        "runs": [],
        "serps": [],
    }


# --------------------------------------------------------------------------
# Views
# --------------------------------------------------------------------------

@router.get("/{project_id}/positions")
def project_positions(
    project_id: int,
    start: str | None = Query(None, description="ISO-8601, inclusive"),
    end: str | None = Query(None, description="ISO-8601, exclusive"),
    db: Session = Depends(get_db),
):
    """Where each keyword stands now: its most recent run inside the window."""
    win = _window(db, project_id, start, end)
    if not win.runs:
        return _empty(win)

    latest: dict[tuple, int] = {}
    # What each run found on each page: how deep it reached, and how many
    # results it stored. Both are needed to say what a slot is worth and what
    # holding one is a share OF.
    pages: dict[tuple, tuple[int, int]] = {}
    for key, run_id, depth, slots in _coverage(db, win.run_by_id):
        pages[(key, run_id)] = (depth, slots)
        current = latest.get(key)
        if current is None or (
            win.run_by_id[run_id].started_at > win.run_by_id[current].started_at
        ):
            latest[key] = run_id
    if not latest:
        return _empty(win)

    cells = _hits(db, win, set(latest.values()))
    weights = get_visibility_weights()
    on_page: dict[tuple, list[dict]] = {}
    for (*key, _host, run_id), cell in cells.items():
        on_page.setdefault((tuple(key), run_id), []).append(cell)

    serps: dict[tuple, dict] = {}
    for key, run_id in latest.items():
        keyword, serp_key = key[0], key[1:]
        run = win.run_by_id[run_id]
        serp = serps.setdefault(serp_key, _serp_shell(serp_key))
        # Best position first: that is the one being reported, and the rest are
        # the other places the project also holds on the same page.
        hits = sorted(on_page.get((key, run_id), []), key=lambda h: (h["position"], h["domain"]))
        # How much of this page the project holds. Every slot counts, not just
        # each domain's best one: a network occupying #2, #5 and #6 has taken
        # three slots off the page, and a figure that only saw its best would
        # report a third of what it actually holds.
        depth, slots = pages.get((key, run_id), (0, 0))
        for hit in hits:
            hit["share"] = round(
                sum(share(p, depth, weights) for p in hit["positions"]), 1,
            )
        held = [p for hit in hits for p in hit["positions"]]

        serp["rows"].append({
            "keyword": keyword,
            "run_id": run_id,
            "job_id": run.job_id,
            "job_name": win.job_names.get(run.job_id),
            "checked_at": run.started_at,
            # Share of the page, and the raw count behind it. The count is what
            # makes the share checkable — "44%" means nothing without "3 of 8".
            "share": round(sum(share(p, depth, weights) for p in held), 1),
            "slots": len(held),
            "slots_total": slots,
            # This page was scored as a short one: the weight of the slots that
            # were not there is spread over the slots that were, so every share
            # on this row is larger than it would be on a full page. True for a
            # genuinely short SERP and for a scrape that came back thin, and
            # those are not the same thing — which is why the slot count is
            # reported beside the share rather than left to be inferred.
            "short_page": depth < len(weights),
            "hits": hits,
        })

    for serp in serps.values():
        serp["rows"].sort(key=lambda r: r["keyword"].lower())
        # The SERP's headline: how much of it the project holds on an average
        # keyword. Averaged over keywords rather than summed, because each
        # keyword is its own page and the shares are not additive across them.
        serp["share"] = round(
            sum(r["share"] for r in serp["rows"]) / len(serp["rows"]), 1,
        ) if serp["rows"] else 0.0

    return {
        "project": {"id": win.project.id, "name": win.project.name, "domains": win.domains},
        "runs": _run_list(win),
        "serps": _ordered(serps),
    }


@router.get("/{project_id}/positions/export.csv")
def export_positions_csv(
    project_id: int,
    start: str | None = Query(None, description="ISO-8601, inclusive"),
    end: str | None = Query(None, description="ISO-8601, exclusive"),
    layout: Literal["grid", "list"] = Query("grid", description="grid: a row per query; list: a row per position"),
    sites: Literal["all", "ours"] = Query("all", description="all: the whole page, ours marked; ours: only ours"),
    lang: Literal["ru", "en"] = Query("ru"),
    tz: int = Query(0, ge=-840, le=840, description="The reader's offset from UTC, minutes east"),
    db: Session = Depends(get_db),
):
    """The latest-view tables as a CSV, with the whole page behind each row.

    Built on ``project_positions`` itself, so every row is the run the table on
    screen shows, with the same monopolisation figure: the file and the page
    can never disagree about which reading is "now".
    """
    data = project_positions(project_id, start, end, db)
    # The same rule the table was built by: the project's domains and the AMP
    # domains named for them.
    whose_host = ours_index(data["project"]["domains"], amp_hosts(db, db.get(Project, project_id)))
    table_rows = [(serp, row) for serp in data["serps"] for row in serp["rows"]]
    run_ids = {row["run_id"] for _serp, row in table_rows}
    job_ids = {row["job_id"] for _serp, row in table_rows}
    prefers_shown = dict(
        db.query(Job.id, Job.prefer_shown_host).filter(Job.id.in_(job_ids or [-1])).all()
    )

    # Every result those runs stored, grouped into the page it came from.
    on_page: dict[tuple, list[tuple]] = {}
    if run_ids:
        found = (
            db.query(
                Result.run_id, Result.keyword, *[getattr(Result, c) for c in SERP_COLUMNS],
                Result.position, Result.domain, Result.shown_host, Result.url, Result.title,
            )
            .filter(Result.run_id.in_(list(run_ids)))
            .order_by(Result.position)
            .all()
        )
        n = len(SERP_COLUMNS)
        for r in found:
            on_page.setdefault((r[0], r[1], tuple(r[2:2 + n])), []).append(tuple(r[2 + n:]))

    # Yandex rows from the API providers store no domain, but they were asked
    # on exactly the domain engine_domains names for their country. Our own
    # phone's rows store the domain their page reported; one of those without
    # it stays empty rather than being given a domain the phone did not use.
    run_provider = {r["id"]: r["provider"] for r in data["runs"]}

    def engine_domain(serp: dict, run_id: int) -> str | None:
        if serp["google_domain"] or serp["engine"] != "yandex" or run_provider.get(run_id) == "own_android":
            return serp["google_domain"]
        return yandex_domain_for(serp["country_code"])

    pages = []
    for serp, row in table_rows:
        serp_key = tuple(serp[c] for c in SERP_COLUMNS)
        prefer = bool(prefers_shown.get(row["job_id"]))
        results = []
        for position, linked, displayed, url, title in on_page.get((row["run_id"], row["keyword"], serp_key), []):
            host = counted_host(linked, displayed, prefer)
            whose = whose_host.get(host.lower())
            if whose is None:
                results.append(PageResult(position, host, False, url, title))
            else:
                results.append(PageResult(position, whose.amp_host or whose.domain, True, url, title,
                                          whose.domain if whose.amp_host else None))
        pages.append(Page(
            **{c: serp[c] for c in SERP_COLUMNS if c != "google_domain"},
            google_domain=engine_domain(serp, row["run_id"]), keyword=row["keyword"], checked_at=row["checked_at"],
            share=row["share"], slots=row["slots"], slots_total=row["slots_total"], results=results,
        ))

    build = grid_rows if layout == "grid" else list_rows
    body = to_csv(build(pages, sites, lang, tz), lang)
    stamp = datetime.now(timezone.utc).strftime("%d-%m-%Y")
    filename = f"{_slugify(data['project']['name'])}_positions_{layout}_{sites}_{stamp}.csv"
    return Response(
        content=body.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{project_id}/positions/average")
def project_position_averages(
    project_id: int,
    start: str | None = Query(None, description="ISO-8601, inclusive"),
    end: str | None = Query(None, description="ISO-8601, exclusive"),
    db: Session = Depends(get_db),
):
    """How each keyword has held up across the window, not where it sits today.

    One reading of a SERP samples a moving thing — personalisation, a rolling
    update, the hour it was taken. Ten readings and their spread say something a
    single one cannot, which is why every cell carries the count behind it and
    the best and worst it saw, not only the mean.
    """
    win = _window(db, project_id, start, end)
    if not win.runs:
        return _empty(win)

    # Which runs measured each (keyword, SERP), and how deep each went. The
    # run count is the denominator of every average: a keyword added to a job
    # halfway through the window was measured fewer times than its neighbours,
    # and its figures have to say so rather than read as if every keyword had
    # the same backing. The depth is what a slot's share of the page is
    # measured against.
    measured: dict[tuple, dict[int, int]] = {}
    for key, run_id, depth, _slots in _coverage(db, win.run_by_id):
        measured.setdefault(key, {})[run_id] = depth
    if not measured:
        return _empty(win)

    # One curve for the whole response: it is a global setting, and reading it
    # per row would let a save halfway through a request score two keywords
    # against different scales.
    weights = get_visibility_weights()

    cells = _hits(db, win, set(win.run_by_id))

    # Every reading of one domain on one keyword, gathered across runs. The run
    # each reading came from travels with it: what a cell blends is decided by
    # the runs the domain actually appeared in, not by every run of the keyword.
    #
    # A line is a project domain, or the AMP side of one — all its AMP hosts
    # together. Two of them on one page are ONE reading of that run, the
    # better placed, as a site with two listings is read by its best: a line
    # cannot have ranked twice in a run.
    best: dict[tuple, dict[int, dict]] = {}
    on_hosts: dict[tuple, set[str]] = {}
    for (*key, (domain, amp_host), run_id), cell in cells.items():
        line = (tuple(key), (domain, amp_host is not None))
        prior = best.setdefault(line, {}).get(run_id)
        if prior is None or cell["position"] < prior["position"]:
            best[line][run_id] = cell
        on_hosts.setdefault(line, set()).add(cell["domain"])
    samples = {line: list(by_run.items()) for line, by_run in best.items()}
    whos = _whos(win)

    serps: dict[tuple, dict] = {}
    for key, depths in measured.items():
        keyword, serp_key = key[0], key[1:]
        run_ids = depths.keys()
        serp = serps.setdefault(serp_key, _serp_shell(serp_key))
        serp.setdefault("run_ids", set()).update(run_ids)

        hits = []
        for who in whos:
            domain, on_amp = who
            readings = samples.get((key, who))
            if not readings:
                continue
            stat = average_position([c["position"] for _rid, c in readings], len(run_ids))
            if stat is None:
                continue
            # Only the runs behind THIS average. Scoping it to the keyword's
            # whole set would flag a single reading from one provider as mixed
            # just because some other run of the same keyword used another.
            providers = [win.run_by_id[rid].provider for rid, _c in readings]
            hits.append({
                "domain": domain,
                # The site's AMP side: its results on its AMP domains. One
                # line for all of them, since the host changes daily — with
                # the hosts these readings were actually on.
                "amp": on_amp,
                "amp_hosts": [
                    {"host": host, **(as_dates(win.amp_periods.get(host)) or {"from": None, "to": None})}
                    for host in sorted(on_hosts[(key, who)])
                ] if on_amp else [],
                "avg_position": stat.average,
                "best": stat.best,
                "worst": stat.worst,
                "ranked_in": stat.ranked_in,
                "runs": stat.runs,
                "present_pct": stat.present_pct,
                "absent_pct": stat.absent_pct,
                # Position and presence on one scale: the share of the page
                # this domain held, averaged over every run including the ones
                # it was absent from. #1 a quarter of the time and #4 every
                # time are finally comparable.
                "visibility": visibility(
                    [(c["position"], depths[rid]) for rid, c in readings],
                    len(run_ids),
                    weights,
                ),
                # Who measured it, so a cell blending two numbering schemes can
                # say so instead of quietly splitting the difference.
                "providers": sorted({p for p in providers if p}),
                "mixed_providers": mixed_providers(providers),
                # Readings from runs made before the provider was recorded per
                # run. They cannot be proved to be a mix, so they do not set the
                # flag above — but they cannot be proved NOT to be one either,
                # and an average that quietly reads as single-provider when it
                # does not know is the same silent wrong answer as an
                # unmarked host substitution.
                "unknown_providers": sum(1 for p in providers if not p),
                # How many readings were credited to the host the engine
                # DISPLAYED rather than the one the link opens. An average must
                # not become the one place a substitution goes unmarked.
                "substituted_in": sum(1 for _rid, c in readings if c["substituted"]),
            })
        # Most visible first. Not by average position: a domain that holds #1
        # on one run in eight is not the most important thing on the row, and
        # sorting by the number that already accounts for that puts the real
        # story at the top. Ties fall back to position, then name, so the order
        # never moves between visits.
        hits.sort(key=lambda h: (-h["visibility"], h["avg_position"], h["domain"], h["amp"]))

        serp["rows"].append({
            "keyword": keyword,
            "runs": len(run_ids),
            # How much of this page the project holds between all its domains.
            # Summable because every slot's share is a fraction of one page:
            # owning every slot is exactly 100.
            "visibility": round(sum(h["visibility"] for h in hits), 1),
            "hits": hits,
        })

    for serp in serps.values():
        serp["rows"].sort(key=lambda r: r["keyword"].lower())
        serp["runs"] = len(serp.pop("run_ids", ()))

    return {
        "project": {"id": win.project.id, "name": win.project.name, "domains": win.domains},
        "runs": _run_list(win),
        "serps": _ordered(serps),
    }


# --------------------------------------------------------------------------
# Position Tracking
# --------------------------------------------------------------------------
#
# A rank tracker's view of the same measurements (user, 2026-10-29: "I want to
# add more granular position tracking like in rank trackers"): how many of the
# project's positions are in the top 3, 5 … 100 of each SERP, against the
# previous period; and every URL of the project's that ranked, with its best
# and average position over the period, its readings, and how it moved.
#
# Decided with the user:
# * The distribution counts POSITIONS, not keywords: a keyword where three of
#   the project's sites hold #1, #4 and #9 adds 3 to the top 10 — how much of
#   the page the network holds.
# * A row is one URL on one keyword in one SERP.
# * The previous period is the previous calendar one (today → yesterday, this
#   week → last week …); the page works it out, as it does the period, in the
#   reader's own clock, and sends both.
# Each period is read by the latest check of every keyword in it, as the
# "Latest" view is.

#: The distribution's columns: positions in the top N. Top 1 first (user,
#: 2026-10-29: "we should add top 1 before top 3 to all the tables and our
#: logic").
TOP_N = (1, 3, 5, 10, 20, 30, 50, 100)
#: Readings sent per row for its sparkline: the latest ones. Best and average
#: are over every reading of the period.
SPARK_POINTS = 60
#: Runs read at a time when looking back past the period for each keyword's
#: previous check.
_LOOKBACK_RUNS = 20


def distribution(positions: Iterable[int]) -> dict[str, int]:
    """How many of the positions are in the top N, for every N of TOP_N."""
    held = list(positions)
    return {str(n): sum(1 for p in held if p <= n) for n in TOP_N}


def page_url(url: str | None) -> str:
    """One spelling per page: providers write a site's front page both as
    "https://example.kz" and "https://example.kz/" — eleven pages here came in
    two spellings, each a row of its own — and letter case does not make
    another page either (user, 2026-10-29: "lower and upper cases should be
    counted as one")."""
    raw = (url or "").strip().lower()
    parts = urlsplit(raw)
    if not parts.scheme or not parts.netloc:
        return raw
    return urlunsplit((parts.scheme, parts.netloc, parts.path or "/", parts.query, ""))


def keyword_key(keyword: str) -> str:
    """A keyword as Position Tracking tells keywords apart: without regard to
    letter case or surrounding spaces, as the project's keywords are listed."""
    return keyword.strip().lower()


def _serp_key_text(serp_key: tuple) -> str:
    return "|".join("" if v is None else str(v) for v in serp_key)


@router.get("/{project_id}/positions/tracking")
def project_position_tracking(
    project_id: int,
    start: str | None = Query(None, description="ISO-8601, inclusive"),
    end: str | None = Query(None, description="ISO-8601, exclusive"),
    prev_start: str | None = Query(None, description="The previous period: ISO-8601, inclusive"),
    prev_end: str | None = Query(None, description="The previous period: ISO-8601, exclusive"),
    db: Session = Depends(get_db),
):
    """Position Tracking for a period: the distribution of the project's
    positions by top N per SERP, against the previous period, and a row per
    ranking URL — see the section comment above."""
    # Every run up to the end of the period: a keyword's previous check may
    # well be from before the period began.
    full = _window(db, project_id, None, end)
    since = _parse_stamp(start, "start")
    p_from, p_to = _parse_stamp(prev_start, "prev_start"), _parse_stamp(prev_end, "prev_end")
    with_prev = p_from is not None and p_to is not None
    in_period = [r for r in full.runs if since is None or r.started_at >= since]
    project = {"id": full.project.id, "name": full.project.name, "domains": full.domains}
    project_clusters = sorted({c for c in (full.project.keyword_clusters or {}).values() if c}, key=str.lower)
    empty = {"project": project, "thresholds": list(TOP_N), "has_previous_period": False,
             "has_clusters": bool(project_clusters), "clusters": project_clusters, "serps": [], "rows": []}
    if not in_period:
        return empty

    def when(run_id: int) -> datetime:
        return full.run_by_id[run_id].started_at

    # A keyword in two letter cases is one keyword (user, 2026-10-29: "lower
    # and upper cases should be counted as one"), named as its latest check
    # spelled it. Should one run hold both spellings, the page of the one met
    # first stands for it, so no position is counted twice.
    spelling: dict[tuple, tuple[datetime, str]] = {}
    page_of: dict[tuple[tuple, int], str] = {}

    def one_key(key: tuple, run_id: int) -> tuple:
        norm = (keyword_key(key[0]), *key[1:])
        page_of.setdefault((norm, run_id), key[0])
        seen = spelling.get(norm)
        if seen is None or when(run_id) > seen[0]:
            spelling[norm] = (when(run_id), key[0])
        return norm

    # Which runs measured each (keyword, SERP) in the period, oldest first,
    # and how deep each went.
    checks: dict[tuple, list[int]] = {}
    depth_of: dict[tuple[tuple, int], int] = {}
    for raw_key, run_id, depth, _slots in _coverage(db, {r.id for r in in_period}):
        key = one_key(raw_key, run_id)
        if page_of[(key, run_id)] != raw_key[0]:
            continue
        checks.setdefault(key, []).append(run_id)
        depth_of[(key, run_id)] = depth
    if not checks:
        return empty
    for runs in checks.values():
        runs.sort(key=when)

    # Each keyword's check before its latest one — inside the period when it
    # was checked twice there, else the latest before the period — and its
    # latest check inside the previous period. Looked for in the runs before
    # the period, newest first, a few at a time, until every keyword has one
    # and the previous period is behind.
    previous: dict[tuple, int] = {key: runs[-2] for key, runs in checks.items() if len(runs) > 1}
    in_prev: dict[tuple, int] = {}
    if with_prev:
        for key, runs in checks.items():
            inside = [r for r in runs if p_from <= when(r) < p_to]
            if inside:
                in_prev[key] = inside[-1]
    earlier = [r for r in full.runs if since is not None and r.started_at < since]   # newest first
    for i in range(0, len(earlier), _LOOKBACK_RUNS):
        batch = earlier[i:i + _LOOKBACK_RUNS]
        found = sorted(_coverage(db, {r.id for r in batch}), key=lambda c: when(c[1]), reverse=True)
        for raw_key, run_id, _depth, _slots in found:
            norm = (keyword_key(raw_key[0]), *raw_key[1:])
            if norm not in checks:
                continue
            key = one_key(raw_key, run_id)
            previous.setdefault(key, run_id)
            if with_prev and p_from <= when(run_id) < p_to:
                in_prev.setdefault(key, run_id)
        all_found = all(key in previous for key in checks)
        past_prev = not with_prev or batch[-1].started_at < p_from
        if all_found and past_prev:
            break

    wanted = {r.id for r in in_period} | set(previous.values()) | set(in_prev.values())
    cells = _hits(db, full, wanted, with_slots=True)
    # Every slot of the project's on every page read: (key, run) →
    # [(position, url, domain, amp_of)].
    on_page: dict[tuple, list[tuple]] = {}
    for (*raw_key, _host, run_id), cell in cells.items():
        key = (keyword_key(raw_key[0]), *raw_key[1:])
        # Only the page that stands for the keyword in that run.
        if page_of.get((key, run_id), raw_key[0]) != raw_key[0]:
            continue
        for position, url in cell["slots"]:
            on_page.setdefault((key, run_id), []).append(
                (position, page_url(url), cell["domain"], cell["amp_of"]))

    def at(key: tuple, run_id: int | None) -> dict[str, int]:
        """URL → its position on that page (the better one if it held two)."""
        out: dict[str, int] = {}
        for position, url, _domain, _amp in on_page.get((key, run_id), []) if run_id else []:
            if url not in out or position < out[url]:
                out[url] = position
        return out

    def best_on(key: tuple, run_id: int | None) -> int | None:
        """The project's best place on that page, if it had one there."""
        held = [p for p, *_rest in on_page.get((key, run_id), [])] if run_id else []
        return min(held) if held else None

    # --- the distribution, per SERP -----------------------------------------
    serps: dict[tuple, dict] = {}
    for key, runs in checks.items():
        serp_key = key[1:]
        latest = runs[-1]
        entry = serps.setdefault(serp_key, {
            **dict(zip(SERP_COLUMNS, serp_key)), "key": _serp_key_text(serp_key),
            "keywords": 0, "depth": 0, "_now": [], "_before": [], "_has_before": False,
            "_check": [], "_has_check": False, "keywords_best": [],
        })
        entry["keywords"] += 1
        # How deep the latest checks go: a top 20 read off pages of ten is
        # the top 10 again, and the page says so.
        entry["depth"] = max(entry["depth"], depth_of.get((key, latest), 0))
        entry["_now"] += [p for p, *_rest in on_page.get((key, latest), [])]
        if key in in_prev:
            entry["_has_before"] = True
            entry["_before"] += [p for p, *_rest in on_page.get((key, in_prev[key]), [])]
        # And at each keyword's check before its latest one (user, 2026-10-29:
        # "Add the same filter to the Обзор" — compare with the previous
        # check, as the table does by default).
        if key in previous:
            entry["_has_check"] = True
            entry["_check"] += [p for p, *_rest in on_page.get((key, previous[key]), [])]
        # Each keyword's best place now and at both points it can be compared
        # with, for the keywords that dropped out of a top (user, 2026-10-29:
        # "the table which will display Кол Выпавших запросов for top 3, top 5,
        # and so on"). `had_*` false: the keyword had no such check; a null
        # place: none of the project's was on that page.
        entry["keywords_best"].append({
            "keyword": spelling[key][1],
            "now": best_on(key, latest),
            "had_check": key in previous,
            "check": best_on(key, previous.get(key)),
            "had_period": key in in_prev,
            "period": best_on(key, in_prev.get(key)),
        })
    for entry in serps.values():
        entry["now"] = distribution(entry.pop("_now"))
        before = entry.pop("_before")
        # Null when no keyword of this SERP was checked in the previous period:
        # nothing to compare with, which is not the same as zero.
        entry["before"] = distribution(before) if entry.pop("_has_before") else None
        # The same at the previous checks; null when none of the SERP's
        # keywords had one.
        at_check = entry.pop("_check")
        entry["before_check"] = distribution(at_check) if entry.pop("_has_check") else None

    # --- a row per URL --------------------------------------------------------
    # Each keyword's cluster, when the project gives it one.
    clusters = {k: c for k, c in (full.project.keyword_clusters or {}).items() if c}
    rows = []
    for key, runs in checks.items():
        keyword, serp_key = spelling[key][1], key[1:]
        readings_by_run = {run_id: at(key, run_id) for run_id in runs}
        prev_check = at(key, previous.get(key))
        prev_period = at(key, in_prev.get(key))
        # Every URL of the project's this keyword had a page with, and whose
        # it is — in the period, or only at a check it is compared with (then
        # it has dropped out since).
        whose: dict[str, tuple[str, str | None]] = {}
        for run_id in [*reversed(runs), previous.get(key), in_prev.get(key)]:
            for _p, url, domain, amp_of in on_page.get((key, run_id), []) if run_id else []:
                whose.setdefault(url, (domain, amp_of))
        latest_run = runs[-1]
        for url, (domain, amp_of) in sorted(whose.items()):
            series = [(run_id, readings_by_run[run_id].get(url)) for run_id in runs]
            present = [p for _r, p in series if p is not None]
            rows.append({
                "serp": _serp_key_text(serp_key),
                "keyword": keyword,
                "cluster": clusters.get(key[0]),
                "url": url,
                "domain": domain,
                "amp_of": amp_of,
                # At the latest check of the period; null = not on that page.
                "position": readings_by_run[latest_run].get(url),
                "checked_at": when(latest_run),
                "best": min(present) if present else None,
                "average": round(fmean(present), 1) if present else None,
                # The sum behind the average, so the page can add the check it
                # compares with to it exactly rather than from a rounded mean.
                "position_sum": sum(present),
                "checks": len(runs),
                "ranked_in": len(present),
                "readings": [{"at": when(r), "position": p} for r, p in series[-SPARK_POINTS:]],
                # What a change is measured against: null = this keyword had
                # no such check; a null position = the URL was not on it.
                "previous_check": {"at": when(previous[key]), "position": prev_check.get(url)}
                if key in previous else None,
                "previous_period": {"at": when(in_prev[key]), "position": prev_period.get(url)}
                if key in in_prev else None,
            })
    rows.sort(key=lambda r: (r["keyword"].lower(), r["serp"], r["position"] or 10_000, r["url"]))
    return {
        "project": project,
        "thresholds": list(TOP_N),
        "has_previous_period": bool(in_prev),
        # The cluster column, filter and export choice are shown for a project
        # that has clusters (user, 2026-10-29: "If the project does not have
        # clusters, do not display this cluster column") — whether or not its
        # clustered keywords were checked in this period.
        "has_clusters": bool(clusters),
        "clusters": sorted(set(clusters.values()), key=str.lower),
        "serps": _ordered(serps),
        "rows": rows,
    }
