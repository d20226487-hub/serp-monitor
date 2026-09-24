"""Substring matching that survives Cyrillic.

Two things break the obvious `LOWER(col) LIKE '%needle%'` on SQLite, and both
of them only show up in the language this tool is mostly used in:

1. SQLAlchemy's JSON type serialises with `json.dumps(..., ensure_ascii=True)`,
   so a keyword list containing "буствин" is stored as the literal text
   `["\\u0431\\u0443\\u0441\\u0442\\u0432\\u0438\\u043d"]`. There is no Cyrillic
   in the column at all, and no LIKE pattern written in Cyrillic can match it.

2. SQLite's built-in `lower()` is ASCII-only unless it was compiled with ICU,
   which the python:3.12-slim image's build is not. So "Буствин" and "буствин"
   stay different strings however the query is written.

Doing the comparison in Python fixes both: `json.loads` undoes the escaping and
`str.lower()` knows about Cyrillic. It runs as a registered SQL function so the
filter still happens in the database, which is what keeps `LIMIT`/`OFFSET` and
the total count honest — filtering in Python afterwards would paginate the
wrong set.

The cost is a Python call per candidate row. A substring match cannot use an
index whatever we do, and this instance holds tens of jobs, so that is not
worth trading correctness for.
"""
from __future__ import annotations

import json

#: Name of the function as registered with SQLite.
CONTAINS_CI = "contains_ci"


def _haystack(value: object) -> str:
    """Flatten a stored column value into text to search.

    A JSON list comes back as its serialised text, so it is decoded first —
    that is what turns the escaped \\uXXXX sequences back into the characters
    the person typed. Anything that is not JSON is searched as-is, which is how
    the same function covers a plain name column too.
    """
    if value is None:
        return ""
    text = value if isinstance(value, str) else str(value)
    try:
        decoded = json.loads(text)
    except (ValueError, TypeError):
        return text
    if isinstance(decoded, list):
        return " ".join(str(item) for item in decoded)
    if isinstance(decoded, dict):
        return " ".join(str(item) for item in decoded.values())
    # A bare JSON scalar — a name that happens to parse, like "123".
    return text


def contains_ci(value: object, needle: object) -> int:
    """1 when `needle` appears in `value`, case-insensitively. SQLite has no
    boolean, so this returns an integer to compare against."""
    if value is None or needle is None:
        return 0
    term = str(needle).strip().lower()
    if not term:
        return 0
    return 1 if term in _haystack(value).lower() else 0


def register_sqlite_functions(dbapi_connection) -> None:
    """Attach the matcher to a raw sqlite3 connection.

    `deterministic` lets SQLite use the result in more places and is supported
    from 3.8.3; it is passed defensively because a build without it raises
    rather than ignoring the argument.
    """
    try:
        dbapi_connection.create_function(
            CONTAINS_CI, 2, contains_ci, deterministic=True,
        )
    except TypeError:  # pragma: no cover — very old SQLite
        dbapi_connection.create_function(CONTAINS_CI, 2, contains_ci)
