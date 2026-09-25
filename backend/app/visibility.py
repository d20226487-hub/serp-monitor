"""How much of a results page a domain actually owns.

A position on its own is a rank, not a quantity: #1 and #2 are one apart and
nothing about that says #1 is worth two and a half times as much. Visibility
turns the rank into a share, by giving each slot a weight and asking what
fraction of the page's weight a domain holds.

The weights are a judgement call dressed as arithmetic, exactly like the
opportunity formula, so they live in Settings rather than in this file. The
defaults are steep — half the page's worth in the first slot — because this
tool watches BRANDED queries, where the first result takes a share of attention
it never would on a research query.

This is not a click-through curve and does not predict traffic. A CTR table
claims "#1 earns 32% of searchers"; a figure like that is wrong the moment the
query, the market or the SERP layout changes. These weights only claim that one
slot is worth so much MORE than another, and the output is a share of one
specific page, which is a far weaker and far more durable claim.

Two calibrations matter, and both fall out of the same denominator:

* A page with fewer slots than the table has rows. Seven results mean the
  attention that would have gone to slots 8-10 goes to the seven that exist,
  so the denominator is the weight of positions 1..7, not 1..10. Holding #1 on
  a seven-result page is worth more than holding #1 on a full one.

* A page whose positions have GAPS. DataForSEO reports rank_absolute, so an
  organic result can sit at #4 with #3 taken by an ad we never stored. That
  attention went to the ad; it is not ours to redistribute. Counting the
  denominator up to the deepest position captured, rather than over the
  positions present, leaves the missing slots' share out of everyone's total —
  which is what actually happened.
"""
from __future__ import annotations

from collections.abc import Iterable, Sequence

#: Share of a branded SERP's attention per slot, steepest first. Any positive
#: scale works — only the ratios matter, because every figure is divided by the
#: total of the slots in play — but these are written to sum to 100 so the
#: running totals read directly as "positions 1..n hold this much of the page".
DEFAULT_WEIGHTS: list[float] = [50.0, 20.0, 10.0, 7.0, 5.0, 3.0, 2.0, 1.0, 1.0, 1.0]


def cumulative(weights: Sequence[float]) -> list[float]:
    """Running totals. Entry i is what positions 1..i+1 hold between them.

    With the defaults this is the familiar 50, 70, 80, 87, 92, 95, 97, 98, 99,
    100 — and it is exactly the denominator a page of that depth is scored
    against.
    """
    out: list[float] = []
    total = 0.0
    for w in weights:
        total += w
        out.append(total)
    return out


def page_total(depth: int, weights: Sequence[float]) -> float:
    """The weight in play on a page captured `depth` positions deep.

    Capped at the table's length: slots past the last weight are worth nothing,
    so scraping a hundred results does not dilute the first ten.
    """
    if depth < 1 or not weights:
        return 0.0
    return cumulative(weights)[min(depth, len(weights)) - 1]


def share(position: int, depth: int, weights: Sequence[float] = DEFAULT_WEIGHTS) -> float:
    """What one slot is worth on that page, as a percentage of the whole page.

    0 for a position past the end of the table: the weights define how far down
    the page is considered visible at all, and a result below that is not.
    """
    if position < 1 or position > len(weights):
        return 0.0
    # A result cannot sit deeper than the page that contained it. If a caller
    # says otherwise, trust the result it actually has over the depth it was
    # told, rather than dividing by a total that excludes the slot being scored.
    total = page_total(max(depth, position), weights)
    if total <= 0:
        return 0.0
    return weights[position - 1] * 100.0 / total


def visibility(
    readings: Iterable[tuple[int, int]],
    runs: int,
    weights: Sequence[float] = DEFAULT_WEIGHTS,
) -> float:
    """A domain's mean share of the page across every run that measured it.

    `readings` are (position, depth) for the runs where the domain appeared;
    `runs` is how many runs measured the keyword at all. Absences are averaged
    in as zero — and that is the point. Position tells you how well a domain
    does when it shows up, presence tells you how often it shows up, and this
    is the one number that is both: #1 on a quarter of the runs and #4 on all
    of them are finally on the same scale.
    """
    scores = [share(pos, depth, weights) for pos, depth in readings]
    if not scores:
        return 0.0
    # A domain cannot appear in more runs than measured it; believe the
    # readings over a denominator that disagrees with them.
    return round(sum(scores) / max(runs, len(scores)), 1)
