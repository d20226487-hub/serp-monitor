"""Bright Data Google = one results page per request.

Measured 2026-10-01: Google ignores `num` (num=20 returned 7-10 organic rows,
every query), and Bright Data numbers each page from rank 1 again. So top-20
is page 1 + page 2, positions continue across pages, and every page is a
billed request the run's cost must count.
"""
from urllib.parse import parse_qs, urlsplit

import pytest

from app.providers import brightdata
from app.providers.brightdata import BrightDataProvider, _build_google_url, google_pages, requests_per_query
from app import tasks


def _page(urls, next_page=True):
    return {"organic": [{"rank": i + 1, "link": u, "title": u} for i, u in enumerate(urls)],
            "pagination": {"next_page": 2, "next_page_start": 10} if next_page else {"current_page": 1}}


class _Scripted(BrightDataProvider):
    """_request replaced by scripted pages; counts requests like the real one."""
    def __init__(self, pages):
        super().__init__()
        self.pages, self.urls = list(pages), []

    async def _request(self, url, **kw):
        self.urls.append(url)
        self.billed_requests += 1
        return self.pages.pop(0)


def _search(p, top_n):
    return p.search_google(keyword="kaspi вход", device="desktop", location=None, language="ru",
                           google_domain="google.com", country_code="kz", top_n=top_n)


def test_pages_and_requests_per_depth():
    assert [google_pages(n) for n in (0, 5, 10, 11, 20, 30, 100, 500)] == [1, 1, 1, 2, 2, 3, 10, 10]
    assert requests_per_query("google", 20) == 2
    assert requests_per_query("yandex", 20) == 1


def test_page_url_asks_for_ten_and_the_offset():
    q = parse_qs(urlsplit(_build_google_url(keyword="k", device="mobile", language="ru", google_domain=None,
                                            country_code="kz", top_n=20, start=10)).query)
    assert q["num"] == ["10"] and q["start"] == ["10"] and q["brd_mobile"] == ["1"]
    first = parse_qs(urlsplit(_build_google_url(keyword="k", device="desktop", language="ru", google_domain=None,
                                                country_code="kz", top_n=20)).query)
    assert "start" not in first


@pytest.mark.asyncio
async def test_top20_takes_two_pages_and_positions_continue():
    p = _Scripted([_page([f"https://a{i}.kz/" for i in range(9)]),
                   _page([f"https://b{i}.kz/" for i in range(10)])])
    rows = await _search(p, 20)
    assert len(p.urls) == 2 and "start=10" in p.urls[1]
    assert [r["position"] for r in rows] == list(range(1, 20))
    assert rows[9]["domain"] == "b0.kz"
    assert p.billed_requests == 2


@pytest.mark.asyncio
async def test_top10_is_one_request():
    p = _Scripted([_page([f"https://a{i}.kz/" for i in range(10)])])
    rows = await _search(p, 10)
    assert len(rows) == 10 and len(p.urls) == 1 and p.billed_requests == 1


@pytest.mark.asyncio
async def test_no_next_page_means_no_second_request():
    p = _Scripted([_page(["https://a.kz/", "https://b.kz/"], next_page=False)])
    rows = await _search(p, 20)
    assert len(rows) == 2 and len(p.urls) == 1


@pytest.mark.asyncio
async def test_no_pager_block_at_all_also_ends_the_serp():
    # "kaspi вход": 5 results, no pager — page 2 came back empty and billed.
    page = _page(["https://kaspi.kz/"])
    del page["pagination"]
    p = _Scripted([page])
    assert len(await _search(p, 20)) == 1 and len(p.urls) == 1


@pytest.mark.asyncio
async def test_a_next_page_link_alone_still_means_page_two():
    first = _page(["https://a.kz/"])
    first["pagination"] = {"current_page": 1, "next_page_link": "https://www.google.com/search?q=k&start=10"}
    p = _Scripted([first, _page(["https://b.kz/"], next_page=False)])
    assert [r["domain"] for r in await _search(p, 20)] == ["a.kz", "b.kz"]


@pytest.mark.asyncio
async def test_a_result_repeated_on_page_two_is_dropped():
    p = _Scripted([_page(["https://a.kz/", "https://b.kz/"]),
                   _page(["https://b.kz/", "https://c.kz/"], next_page=False)])
    rows = await _search(p, 20)
    assert [r["url"] for r in rows] == ["https://a.kz/", "https://b.kz/", "https://c.kz/"]
    assert [r["position"] for r in rows] == [1, 2, 4]


def test_spend_prices_requests_not_queries(monkeypatch):
    monkeypatch.setattr(tasks, "get_provider_rate", lambda name: 0.0015)
    p = BrightDataProvider()
    p.billed_requests = 6          # 3 top-20 queries
    assert tasks._provider_spend("brightdata", p, 3) == {"cost": 0.009, "source": "estimate", "queries": 3}
