"""The project positions tables as a CSV an SEO can open and read (user,
2026-10-02): "which positions, on which queries, by which sites".

Pure — rows in, text out — so what the file SAYS is tested without a database;
the endpoint in routers/project_positions.py only gathers the rows.

Two layouts, because the file has two kinds of reader:

* ``grid`` — one row per query, columns 1…N hold the site at each position. Read
  by eye: a query's whole page is one line.
* ``list`` — one row per position. For filters and pivot tables.

And two scopes: ``all`` puts every site on the page in the file, ours marked;
``ours`` keeps only the project's own sites, which is what the tables show.

The page is the one the tables show: per (query, SERP), the LATEST run inside
the window. A site "is ours" by the same rule as the tables: the project
domain, or its www. spelling, of the host the result counts as (the displayed
host when the job prefers it).

Russian files use ";" between fields and a decimal comma, because that is what
Excel in a Russian locale expects: with "," every row lands in column A, and
"10.1" turns into a date. English files use "," and a decimal point. Both carry
a UTF-8 BOM, or Excel shows Cyrillic as mojibake.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta
from typing import NamedTuple

OURS_MARK = "★ "
#: A top-100 job is the deepest anything here scrapes; never more columns.
MAX_COLUMNS = 100


class PageResult(NamedTuple):
    position: int
    host: str
    ours: bool
    url: str | None
    title: str | None


class Page(NamedTuple):
    """One row of a positions table, with the whole page it was read from."""
    engine: str
    device: str
    country_code: str | None
    location: str | None
    language: str | None
    google_domain: str | None
    keyword: str
    checked_at: datetime | None
    #: The project's share of this page, % — the tables' "monopolisation".
    share: float
    #: How many results on the page are ours, and how many the run captured.
    slots: int
    slots_total: int
    results: list[PageResult]


_LABELS = {
    "ru": {
        "engine": "Поисковик", "device": "Устройство", "country": "Страна", "location": "Локация",
        "language": "Язык", "google_domain": "Домен поисковика", "keyword": "Запрос",
        "share": "Монополизация, %", "ours_list": "Наши позиции", "slots": "Наших результатов",
        "slots_total": "Результатов на странице", "checked": "Проверено", "position": "Позиция",
        "site": "Сайт", "is_ours": "Наш сайт", "url": "URL", "title": "Заголовок",
        "yes": "да", "no": "нет", "google": "Google", "yandex": "Яндекс",
        "mobile": "Мобильный", "desktop": "Десктоп",
    },
    "en": {
        "engine": "Engine", "device": "Device", "country": "Country", "location": "Location",
        "language": "Language", "google_domain": "Engine domain", "keyword": "Query",
        "share": "Monopolisation, %", "ours_list": "Our positions", "slots": "Our results",
        "slots_total": "Results on page", "checked": "Checked", "position": "Position",
        "site": "Site", "is_ours": "Our site", "url": "URL", "title": "Title",
        "yes": "yes", "no": "no", "google": "Google", "yandex": "Yandex",
        "mobile": "Mobile", "desktop": "Desktop",
    },
}


def counted_host(linked: str | None, displayed: str | None, prefer_shown: bool) -> str:
    """The host a result counts as — the rule the positions tables use."""
    linked = (linked or "").lower()
    return (displayed or linked) if prefer_shown else linked


def project_domain(host: str, domains: list[str]) -> str | None:
    """The project domain this host is, if any: exact, or its www. spelling.
    A subdomain is NOT its parent — the project stores those separately."""
    host = host.lower()
    for d in domains:
        if host in (d, f"www.{d}"):
            return d
    return None


def _num(value: float, lang: str) -> str:
    text = f"{value:g}" if float(value).is_integer() else f"{value:.1f}"
    return text.replace(".", ",") if lang == "ru" else text


def _when(dt: datetime | None, tz_minutes: int) -> str:
    """Run times are stored naive UTC; written in the reader's own clock."""
    return (dt + timedelta(minutes=tz_minutes)).strftime("%Y-%m-%d %H:%M") if dt else ""


def _place(p: Page, L: dict, lang: str) -> list[str]:
    # The city alone: "Bishkek,Bishkek,Kyrgyzstan" repeats what the country
    # column already says, on every row.
    city = (p.location or "").split(",")[0].strip()
    return [
        L.get(p.engine, p.engine), L.get(p.device, p.device), (p.country_code or "").upper(), city,
        p.language or "", p.google_domain or "",
    ]


def _shown(results: list[PageResult], sites: str) -> list[PageResult]:
    return [r for r in results if r.ours] if sites == "ours" else list(results)


def grid_rows(pages: list[Page], sites: str, lang: str, tz_minutes: int = 0) -> list[list[str]]:
    """Header + one row per query; columns 1…N are the positions."""
    L = _LABELS[lang]
    depth = min(MAX_COLUMNS, max((r.position for p in pages for r in p.results), default=0))
    header = [L["engine"], L["device"], L["country"], L["location"], L["language"], L["google_domain"],
              L["keyword"], L["share"], L["ours_list"], L["slots"], L["slots_total"], L["checked"],
              *[str(i) for i in range(1, depth + 1)]]
    rows = [header]
    for p in pages:
        cells = [""] * depth
        for r in _shown(p.results, sites):
            if 1 <= r.position <= depth:
                # Ours carry a mark only where the row also shows other sites.
                name = f"{OURS_MARK}{r.host}" if (r.ours and sites == "all") else r.host
                # Two results on one slot should not happen; if it does, both show.
                cells[r.position - 1] = f"{cells[r.position - 1]} | {name}" if cells[r.position - 1] else name
        ours = ", ".join(f"{r.position} {r.host}" for r in p.results if r.ours)
        rows.append([*_place(p, L, lang), p.keyword, _num(p.share, lang), ours, str(p.slots),
                     str(p.slots_total), _when(p.checked_at, tz_minutes), *cells])
    return rows


def list_rows(pages: list[Page], sites: str, lang: str, tz_minutes: int = 0) -> list[list[str]]:
    """Header + one row per result."""
    L = _LABELS[lang]
    header = [L["engine"], L["device"], L["country"], L["location"], L["language"], L["google_domain"],
              L["keyword"], L["position"], L["site"], L["is_ours"], L["url"], L["title"], L["share"],
              L["checked"]]
    rows = [header]
    for p in pages:
        for r in _shown(p.results, sites):
            rows.append([*_place(p, L, lang), p.keyword, str(r.position), r.host,
                         L["yes"] if r.ours else L["no"], r.url or "", r.title or "",
                         _num(p.share, lang), _when(p.checked_at, tz_minutes)])
    return rows


def to_csv(rows: list[list[str]], lang: str) -> str:
    buf = io.StringIO()
    csv.writer(buf, delimiter=";" if lang == "ru" else ",", lineterminator="\r\n").writerows(rows)
    return "﻿" + buf.getvalue()
