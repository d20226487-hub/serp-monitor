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
from typing import NamedTuple

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..app_settings import get_visibility_weights
from ..db import get_db
from ..models import Job, JobRun, Project, Result
from ..visibility import share, visibility

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


def _host_variants(domain: str) -> list[str]:
    """The spellings a result host might use for this domain."""
    return [domain, f"www.{domain}"]


class _Window(NamedTuple):
    """Everything both views need before they diverge."""
    project: Project
    domains: list[str]
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

    return _Window(
        project=project,
        domains=list(project.domains or []),
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


def _hits(db: Session, win: _Window, run_ids: set[int]) -> dict[tuple, dict]:
    """One entry per (keyword, SERP, domain, run), for the project's domains.

    A site can hold several slots on one page, and the two questions about that
    want different answers. `position` is the best of them — the position the
    site "has", because averaging #4, #6 and #9 would rank a site with three
    listings below one with a single #5. `positions` is all of them, because
    how much of the page a network occupies is exactly the count it holds.
    """
    cells: dict[tuple, dict] = {}
    if not win.domains or not run_ids:
        return cells

    wanted_hosts = [h for d in win.domains for h in _host_variants(d)]
    host_to_domain = {h: d for d in win.domains for h in _host_variants(d)}
    # Both hosts are candidates, so the filter cannot be a plain IN on `domain`:
    # a result whose LINK is a cloudfront host still matches when the engine
    # displayed the publisher.
    rows = (
        db.query(
            Result.keyword, *[getattr(Result, c) for c in SERP_COLUMNS],
            Result.run_id, Result.domain, Result.position, Result.url,
            Result.shown_host,
        )
        .filter(
            Result.run_id.in_(list(run_ids)),
            or_(
                Result.domain.in_(wanted_hosts),
                Result.shown_host.in_(wanted_hosts),
            ),
        )
        .all()
    )
    for row in rows:
        key = tuple(row[: 1 + len(SERP_COLUMNS)])
        run_id, host, position, url, displayed = row[-5:]
        linked_host = (host or "").lower()
        use_displayed = win.prefers_shown.get(win.run_by_id[run_id].job_id, False)
        # The host this result counts as. Only the displayed one when the job
        # asked for that AND the engine actually reported one.
        counted = (displayed or linked_host) if use_displayed else linked_host
        domain = host_to_domain.get(counted)
        if domain is None:
            continue
        made = {
            "domain": domain,
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
        cell_key = (*key, domain, run_id)
        prior = cells.get(cell_key)
        if prior is None:
            made["positions"] = [position]
            cells[cell_key] = made
        else:
            # Every slot is kept; which one supplies the headline fields —
            # the URL, the displayed host, the substitution flag — is decided
            # by the best of them, so a row describes the listing it reports.
            prior["positions"].append(position)
            if position < prior["position"]:
                made["positions"] = prior["positions"]
                cells[cell_key] = made
    for cell in cells.values():
        cell["positions"].sort()
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

    serps: dict[tuple, dict] = {}
    for key, run_id in latest.items():
        keyword, serp_key = key[0], key[1:]
        run = win.run_by_id[run_id]
        serp = serps.setdefault(serp_key, _serp_shell(serp_key))
        # Best position first: that is the one being reported, and the rest are
        # the other places the project also holds on the same page.
        hits = sorted(
            (
                cells[(*key, d, run_id)]
                for d in win.domains if (*key, d, run_id) in cells
            ),
            key=lambda h: h["position"],
        )
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
    samples: dict[tuple, list[tuple[int, dict]]] = {}
    for (*key, domain, run_id), cell in cells.items():
        samples.setdefault((tuple(key), domain), []).append((run_id, cell))

    serps: dict[tuple, dict] = {}
    for key, depths in measured.items():
        keyword, serp_key = key[0], key[1:]
        run_ids = depths.keys()
        serp = serps.setdefault(serp_key, _serp_shell(serp_key))
        serp.setdefault("run_ids", set()).update(run_ids)

        hits = []
        for domain in win.domains:
            readings = samples.get((key, domain))
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
        hits.sort(key=lambda h: (-h["visibility"], h["avg_position"], h["domain"]))

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
