"""Crontab expressions as people write them, for APScheduler.

APScheduler 3 numbers weekdays 0 = Monday … 6 = Sunday, and
`CronTrigger.from_crontab` passes the day-of-week field through untranslated.
A standard crontab means 0 (or 7) = Sunday, 1 = Monday — so "1-5" ran
Tuesday to Saturday, the "Weekdays 08:00" preset among them, and "7" was
refused outright. Found while auditing the docs (2026-10-14).

Weekday NUMBERS are therefore turned into names before the expression reaches
APScheduler, which reads names the same way crontab does. Names, and every
other field, pass through untouched. Pure: no scheduler, no database.
"""
from __future__ import annotations

import re

#: Crontab's weekday numbers; 7 is Sunday again.
_NAMES = ("sun", "mon", "tue", "wed", "thu", "fri", "sat")
_NUMERIC = re.compile(r"[\d*,/\-]+")


def weekdays(field: str) -> set[int]:
    """The crontab weekdays (0 = Sunday … 6 = Saturday) a numeric day-of-week
    field stands for: "1-5", "0,6", "*/2", "1-5/2", "7". Raises ValueError on
    anything else."""
    days: set[int] = set()
    for part in field.split(","):
        span, _, step_text = part.partition("/")
        step = int(step_text) if step_text else 1
        if step < 1:
            raise ValueError(f"bad step in day of week: {part!r}")
        if span == "*":
            lo, hi = 0, 6
        elif "-" in span:
            a, b = span.split("-", 1)
            lo, hi = int(a), int(b)
        else:
            lo = int(span)
            # "1/2" is "from 1, every 2nd" in crontab.
            hi = 7 if step_text else lo
        if not (0 <= lo <= 7 and 0 <= hi <= 7 and lo <= hi):
            raise ValueError(f"day of week out of range: {part!r}")
        days.update(d % 7 for d in range(lo, hi + 1, step))
    return days


def to_apscheduler(expr: str) -> str:
    """The same expression with its weekday numbers as names. "0 8 * * 1-5"
    becomes "0 8 * * mon,tue,wed,thu,fri"; an expression without weekday
    numbers comes back unchanged."""
    fields = expr.split()
    if len(fields) != 5 or fields[4] == "*" or not _NUMERIC.fullmatch(fields[4]):
        return expr
    days = weekdays(fields[4])
    if days == set(range(7)):
        fields[4] = "*"
    else:
        # Monday first, as the week is read here.
        fields[4] = ",".join(_NAMES[d] for d in sorted(days, key=lambda d: (d + 6) % 7))
    return " ".join(fields)
