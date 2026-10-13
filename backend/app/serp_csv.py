"""A SERP read by another tool, uploaded to a project as a CSV.

User, 2026-10-13: "we will use an internal tool to check the SERP, then we
will upload a CSV to each project", with an example export, and which of its
columns count: "Take only these 4 — Keywords, GEO, Domain / URL, Position.
You can ignore … Project, Tags, SEO, Partner, Neutral, Position score, Quality
Status and others unspecified above". An upload "will equal прогон": it
becomes a run of the project like any other.

The example:

    Project,Keywords,GEO,Result type,Domain / URL,Tags,Position,SEO,…
    Example project,casino az,Azerbaijan,Organic,https://url1.com,…,1,No,…
    Example project,casino az,Azerbaijan,Organic,–,–,7,–,…

* A row is one position of one keyword in one country.
* GEO is a country, by its English name ("Azerbaijan") or its ISO code; a row
  whose country is not recognised is left out and reported, not guessed at.
* "–" in Domain / URL is a position the tool listed with nothing on it: no
  result to store, so the row is skipped (counted, not an error).
* The file says nothing of the search engine or the device, and a run's SERPs
  are told apart by both — so those two are given with the upload.

Everything here is pure: text in, rows and a report out. The router does the
decoding, the countries and the writing.
"""
from __future__ import annotations

import csv
import io
import re
import unicodedata
from collections import Counter
from typing import NamedTuple
from urllib.parse import urlparse

#: The four columns that are read, by the names they may carry (compared in
#: lower case, spaces collapsed, none around a slash).
COLUMNS = {
    "keyword": ("keywords", "keyword"),
    "geo": ("geo", "country"),
    "url": ("domain/url", "url/domain", "url", "domain"),
    "position": ("position", "pos"),
}
#: What an export writes where there is nothing.
EMPTY = {"", "-", "–", "—", "n/a", "none", "null"}
#: Country names an export may still use that today's lists spell otherwise.
ALIASES = {
    "turkey": "TR", "czech republic": "CZ", "russian federation": "RU", "kyrgyz republic": "KG",
    "usa": "US", "united states of america": "US", "uk": "GB", "great britain": "GB", "uae": "AE",
    "south korea": "KR", "ivory coast": "CI", "moldova": "MD", "vietnam": "VN",
}


class Row(NamedTuple):
    keyword: str
    geo: str            # ISO code, upper case
    url: str
    domain: str
    position: int


class Parsed(NamedTuple):
    rows: list[Row]
    #: Positions listed with nothing on them.
    empty: int
    #: GEO value → how many rows were left out because of it.
    unknown_geos: dict[str, int]
    #: (line number, why) for rows that could not be read at all.
    bad: list[tuple[int, str]]


class MissingColumns(ValueError):
    """The file has no column for one of the four that are read."""

    def __init__(self, missing: list[str], found: list[str]):
        super().__init__(f"missing columns: {', '.join(missing)}")
        self.missing, self.found = missing, found


def fold(value: str) -> str:
    """A name as it is compared: lower case, no accents, single spaces."""
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", text).strip().lower()


def _header(value: str) -> str:
    return re.sub(r"\s*/\s*", "/", fold(value.lstrip("﻿")))


def delimiter(header_line: str) -> str:
    """Comma from a spreadsheet export, semicolon from a Russian-locale Excel,
    tab from a copy: whichever the header has most of."""
    return max((",", ";", "\t"), key=header_line.count)


def countries_index(pairs: list[tuple[str, str]]) -> dict[str, str]:
    """Name or code, folded → ISO code. `pairs` are (name, ISO code)."""
    index = {fold(alias): code for alias, code in ALIASES.items()}
    for name, code in pairs:
        if name and code:
            index[fold(name)] = code.upper()
            index[code.lower()] = code.upper()
    return index


def target(value: str) -> tuple[str, str] | None:
    """(url, host) for a Domain / URL cell — a full address or a bare domain."""
    value = value.strip()
    if fold(value) in EMPTY or " " in value:
        return None
    url = value if re.match(r"^[a-z][a-z0-9+.-]*://", value, flags=re.I) else f"https://{value}"
    try:
        host = (urlparse(url).hostname or "").lower().rstrip(".")
    except ValueError:
        return None
    return (url, host) if "." in host else None


def parse(text: str, countries: dict[str, str]) -> Parsed:
    """Read the four columns out of an export. Raises MissingColumns when one
    of them is not there; everything else is reported in the result."""
    lines = text.lstrip("﻿").splitlines()
    first = next((line for line in lines if line.strip()), "")
    reader = csv.reader(io.StringIO(text.lstrip("﻿")), delimiter=delimiter(first))
    header: list[str] | None = None
    where: dict[str, int] = {}
    rows: list[Row] = []
    empty = 0
    unknown: Counter[str] = Counter()
    bad: list[tuple[int, str]] = []
    for cells in reader:
        if header is None:
            if not any(c.strip() for c in cells):
                continue
            header = [_header(c) for c in cells]
            for field, names in COLUMNS.items():
                at = next((header.index(n) for n in names if n in header), None)
                if at is not None:
                    where[field] = at
            missing = [COLUMNS[f][0] for f in COLUMNS if f not in where]
            if missing:
                raise MissingColumns(missing, [c.strip() for c in cells if c.strip()])
            continue
        line = reader.line_num
        if not any(c.strip() for c in cells):
            continue

        def cell(field: str) -> str:
            at = where[field]
            return cells[at].strip() if at < len(cells) else ""

        keyword, geo_text = cell("keyword"), cell("geo")
        found = target(cell("url"))
        if found is None:
            # "–": the tool listed the position and had nothing for it.
            if fold(cell("url")) in EMPTY:
                empty += 1
            else:
                bad.append((line, f"not an address or a domain: {cell('url')[:60]!r}"))
            continue
        if not keyword:
            bad.append((line, "no keyword"))
            continue
        try:
            position = int(float(cell("position").replace(",", ".")))
        except ValueError:
            bad.append((line, f"position is not a number: {cell('position')[:20]!r}"))
            continue
        if position < 1:
            bad.append((line, f"position is not a number from 1 up: {position}"))
            continue
        code = countries.get(fold(geo_text))
        if code is None:
            unknown[geo_text or "(empty)"] += 1
            continue
        rows.append(Row(keyword, code, found[0], found[1], position))
    if header is None:
        raise MissingColumns([COLUMNS[f][0] for f in COLUMNS], [])
    return Parsed(rows, empty, dict(unknown), bad)


def decode(raw: bytes) -> str:
    """UTF-8 as spreadsheets export it; Windows-1251 as a Russian-locale Excel
    saves it — tried in that order, since a 1251 file is not valid UTF-8."""
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("cp1251", errors="replace")
