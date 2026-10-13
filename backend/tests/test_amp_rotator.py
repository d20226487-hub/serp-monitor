"""AMP Rotator: today's AMP domain of each of a project's domains
(user, 2026-10-13). The API, as its own description gives it:

    POST https://<rotator-host>/api/   HTTP Basic   ["domain.com", "domain2.com"]
    200 {"domain.com": "<AMP host>", "domain2.com": ""}      "" = unknown site
"""
import base64
import json
from datetime import datetime

import httpx

from app.amp_rotator import clean_host, fetch, is_due, last_tick, read_answer, valid_time

URL = "https://rotator.example/api/"
SENT = ["domain.com", "domain2.com", "unknown.com"]


class TestReadingTheAnswer:
    def test_the_documented_shape(self):
        data = {"domain.com": "active.amp-one.example", "domain2.com": "active2.amp-two.example"}
        assert read_answer(data, SENT) == data

    def test_an_unknown_site_comes_back_empty_and_is_left_out(self):
        assert read_answer({"domain.com": "a.amp.example", "unknown.com": ""}, SENT) == {"domain.com": "a.amp.example"}

    def test_only_domains_that_were_asked_about_are_believed(self):
        assert read_answer({"someone-else.com": "a.amp.example"}, SENT) == {}

    def test_the_amp_host_is_kept_as_a_bare_lower_case_host(self):
        data = {"Domain.COM": " HTTPS://Active.AMP.example/page ", "domain2.com": "amp.example."}
        assert read_answer(data, SENT) == {"domain.com": "active.amp.example", "domain2.com": "amp.example"}

    def test_what_is_not_a_host_is_left_out(self):
        for value in (None, 1, True, [], {}, "", "   ", "not a host", "localhost"):
            assert read_answer({"domain.com": value}, SENT) == {}, value

    def test_an_answer_of_another_shape_says_nothing(self):
        for data in (None, "ok", [], ["domain.com"], 5):
            assert read_answer(data, SENT) == {}

    def test_clean_host(self):
        assert clean_host("https://A.b.example:8443/x?y") == "a.b.example"
        assert clean_host("a.example") == "a.example"
        assert clean_host("") is None and clean_host(None) is None and clean_host("nodot") is None


class TestAsking:
    def _fetch(self, handler, username="rotator-user", password="rotator-pass-123"):
        seen = {}

        def wrapped(request: httpx.Request) -> httpx.Response:
            seen.update(method=request.method, url=str(request.url), auth=request.headers.get("authorization"),
                        ctype=request.headers.get("content-type"), body=json.loads(request.content))
            return handler(request)

        with httpx.Client(transport=httpx.MockTransport(wrapped)) as client:
            return fetch(URL, username, password, SENT, client), seen

    def test_a_post_with_basic_auth_and_the_domains_as_a_json_array(self):
        got, seen = self._fetch(lambda r: httpx.Response(200, json={"domain.com": "a.amp.example", "unknown.com": ""}))
        assert seen["method"] == "POST" and seen["url"] == URL
        assert seen["body"] == SENT
        assert seen["ctype"] == "application/json"
        assert seen["auth"] == "Basic " + base64.b64encode(b"rotator-user:rotator-pass-123").decode()
        assert (got.ok, got.status_code, got.amp, got.error) == (True, 200, {"domain.com": "a.amp.example"}, None)

    def test_an_answer_naming_nothing_is_still_an_answer(self):
        got, _ = self._fetch(lambda r: httpx.Response(200, json={d: "" for d in SENT}))
        assert got.ok and got.amp == {}

    def test_a_refusal_is_an_outcome_not_an_exception(self):
        got, _ = self._fetch(lambda r: httpx.Response(401, text="Unauthorized"))
        assert (got.ok, got.status_code, got.amp) == (False, 401, {})
        assert got.error == "HTTP 401: Unauthorized"

    def test_an_answer_that_is_not_the_mapping_is_a_failure(self):
        got, _ = self._fetch(lambda r: httpx.Response(200, text="<html>login</html>"))
        assert not got.ok and got.error == "the answer is not JSON"
        got, _ = self._fetch(lambda r: httpx.Response(200, json=["domain.com"]))
        assert not got.ok and "mapping" in got.error

    def test_an_unreachable_rotator_is_an_outcome_too(self):
        def boom(request):
            raise httpx.ConnectError("no route to host")

        got, _ = self._fetch(boom)
        assert (got.ok, got.status_code) == (False, None) and "ConnectError" in got.error

    def test_an_address_that_is_not_one_is_an_outcome_too(self):
        got = fetch("not an address", "u", "p", SENT)
        assert (got.ok, got.status_code) == (False, None) and got.error

    def test_the_credentials_are_never_in_the_error(self):
        # A server that echoes what it was sent, and an address typed with the
        # credentials inside it.
        got, _ = self._fetch(lambda r: httpx.Response(403, text="denied for rotator-user / rotator-pass-123"))
        assert "rotator-pass-123" not in got.error and "rotator-user" not in got.error

        def boom(request):
            raise httpx.ConnectError(f"cannot reach {request.url}")

        with httpx.Client(transport=httpx.MockTransport(boom)) as client:
            got = fetch("https://rotator-user:rotator-pass-123@rotator.example/api/", "rotator-user",
                        "rotator-pass-123", SENT, client)
        assert "rotator-pass-123" not in got.error


class TestTheDailyMoment:
    def test_hh_mm_only(self):
        assert valid_time("02:00") and valid_time("23:59")
        for bad in (None, "", "2:00", "24:00", "02:60", "0200", "noon"):
            assert not valid_time(bad), bad

    def test_the_latest_tick_is_today_once_it_has_passed_and_yesterdays_before(self):
        assert last_tick(datetime(2026, 10, 13, 5, 0), "02:00") == datetime(2026, 10, 13, 2, 0)
        assert last_tick(datetime(2026, 10, 13, 2, 0), "02:00") == datetime(2026, 10, 13, 2, 0)
        assert last_tick(datetime(2026, 10, 13, 1, 59), "02:00") == datetime(2026, 10, 12, 2, 0)

    def test_an_endpoint_owes_a_fetch_until_it_has_one_from_after_the_latest_tick(self):
        now = datetime(2026, 10, 13, 9, 0)                  # the app starts at 09:00, hours after 02:00
        assert is_due(None, now, "02:00")                   # never asked
        assert is_due(datetime(2026, 10, 12, 2, 0, 5), now, "02:00")       # yesterday's fetch
        assert not is_due(datetime(2026, 10, 13, 2, 0, 5), now, "02:00")   # today's is in
        assert not is_due(datetime(2026, 10, 13, 8, 0), now, "02:00")      # fetched by hand this morning
        # Before today's moment, yesterday's fetch is still the current one.
        assert not is_due(datetime(2026, 10, 12, 2, 0, 5), datetime(2026, 10, 13, 1, 0), "02:00")
