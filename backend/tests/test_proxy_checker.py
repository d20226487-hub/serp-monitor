import json

import httpx

from app.proxy_checker import (
    RAW_BODY_LIMIT, build_payload, clean_geos, curl_command, geos_to_send, group_found, keep_geos,
    request_body, send_one, valid_time,
)

DOMAINS = ["lucky-zazino.pro", "zazino.kg", "upgraded-boostwincasino.icu"]


class TestWhatIsSent:
    """Country → the project's own domains the checks found there."""

    def test_grouped_by_country_in_upper_case_sorted_once_each(self):
        rows = [
            ("kg", "zazino.kg", None, False),
            ("kg", "lucky-zazino.pro", None, False),
            ("kg", "zazino.kg", None, False),            # found for a second keyword
            ("kz", "lucky-zazino.pro", None, False),
        ]
        assert group_found(rows, DOMAINS) == {
            "KG": ["lucky-zazino.pro", "zazino.kg"],
            "KZ": ["lucky-zazino.pro"],
        }

    def test_only_the_projects_own_domains(self):
        rows = [("kg", "casino.kg", None, False), ("kg", "zazino.kg", None, False)]
        assert group_found(rows, DOMAINS) == {"KG": ["zazino.kg"]}

    def test_www_is_the_same_site_a_subdomain_is_not(self):
        rows = [("kg", "www.zazino.kg", None, False), ("kz", "m.zazino.kg", None, False)]
        assert group_found(rows, DOMAINS) == {"KG": ["zazino.kg"]}

    def test_the_displayed_host_counts_only_when_the_job_prefers_it(self):
        # An AMP/CDN link printed as our brand: ours for a job that counts
        # displayed hosts, somebody's CDN for one that does not.
        row = ("kg", "d1.cloudfront.net", "zazino.kg", True)
        assert group_found([row], DOMAINS) == {"KG": ["zazino.kg"]}
        assert group_found([("kg", "d1.cloudfront.net", "zazino.kg", False)], DOMAINS) == {}

    def test_a_check_without_a_country_is_sent_nowhere(self):
        assert group_found([(None, "zazino.kg", None, False), ("", "zazino.kg", None, False)], DOMAINS) == {}

    def test_nothing_found_nothing_to_send(self):
        assert group_found([], DOMAINS) == {}
        assert group_found([("kg", "zazino.kg", None, False)], []) == {}


class TestRequest:
    """The exact request the user specified (2026-10-05)."""

    def test_payload_shape(self):
        assert build_payload("KG", ["lucky-zazino.pro", "upgraded-boostwincasino.icu"]) == {
            "DailyCheck": {"geo": "KG", "domains": ["lucky-zazino.pro", "upgraded-boostwincasino.icu"]}
        }

    def test_post_with_a_bearer_token_and_that_body(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen.update(method=request.method, url=str(request.url),
                        auth=request.headers.get("authorization"),
                        ctype=request.headers.get("content-type"), body=json.loads(request.content))
            return httpx.Response(200, json={"status": "ok"})

        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            sent = send_one("https://proxy-monitor.example/api/daily-check", "s3cret",
                            "KG", ["lucky-zazino.pro"], client)
        assert (sent.ok, sent.status_code) == (True, 200) and "ok" in sent.excerpt
        assert seen == {
            "method": "POST", "url": "https://proxy-monitor.example/api/daily-check",
            "auth": "Bearer s3cret", "ctype": "application/json",
            "body": {"DailyCheck": {"geo": "KG", "domains": ["lucky-zazino.pro"]}},
        }

    def test_a_refusal_is_an_outcome_not_an_exception(self):
        with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(403, text="Forbidden"))) as client:
            assert send_one("https://x.example/api", "bad", "KG", ["a.com"], client)[:3] == (False, 403, "Forbidden")

    def test_an_unreachable_server_is_an_outcome_too(self):
        def boom(request):
            raise httpx.ConnectError("no route to host")

        with httpx.Client(transport=httpx.MockTransport(boom)) as client:
            sent = send_one("https://x.example/api", "t", "KG", ["a.com"], client)
        assert (sent.ok, sent.status_code) == (False, None) and "ConnectError" in sent.excerpt
        # No HTTP answer: the "raw response" is the transport's own error, and
        # the request that was attempted is still there to show.
        assert "ConnectError" in sent.raw and "no route to host" in sent.raw
        assert curl_command(sent.request).startswith('curl -i -X POST "https://x.example/api" ')

    def test_an_address_that_is_not_one_is_an_outcome_too(self):
        sent = send_one("not an address", "t", "KG", ["a.com"])
        assert (sent.ok, sent.status_code) == (False, None) and sent.raw


TOKEN = "s3cret-token-value"


class TestRequestAndRawAnswer:
    """User, 2026-10-06: "When sending to Proxy checker can we show the curl
    and the raw response from the Proxy Checker"."""

    def _send(self, handler, domains=("lucky-zazino.pro", "zazino.kg")):
        seen = {}

        def wrapped(request: httpx.Request) -> httpx.Response:
            seen.update(body=request.content.decode(), headers=dict(request.headers))
            return handler(request)

        with httpx.Client(transport=httpx.MockTransport(wrapped)) as client:
            sent = send_one("https://proxy-monitor.example/api/daily-check", TOKEN, "KG", list(domains), client)
        return sent, seen

    def test_the_body_shown_is_the_body_sent(self):
        sent, seen = self._send(lambda r: httpx.Response(200, json={"status": "ok"}))
        want = '{"DailyCheck":{"geo":"KG","domains":["lucky-zazino.pro","zazino.kg"]}}'
        assert request_body("KG", ["lucky-zazino.pro", "zazino.kg"]) == want
        assert seen["body"] == want == sent.request["body"]

    def test_the_headers_shown_are_the_headers_sent_except_the_token(self):
        sent, seen = self._send(lambda r: httpx.Response(200, json={}))
        shown = {name.lower(): value for name, value in sent.request["headers"]}
        assert seen["headers"]["authorization"] == f"Bearer {TOKEN}"        # what really went
        assert shown.pop("authorization") == "Bearer <token>"               # what is kept
        for name, value in shown.items():
            assert seen["headers"][name] == value, name
        assert set(shown) == {"accept", "content-type", "user-agent"}

    def test_the_curl(self):
        sent, _ = self._send(lambda r: httpx.Response(200, json={}), domains=["zazino.kg"])
        assert curl_command(sent.request) == (
            'curl -i -X POST "https://proxy-monitor.example/api/daily-check"'
            ' -H "Authorization: Bearer <token>"'
            ' -H "Accept: application/json"'
            ' -H "Content-Type: application/json"'
            f' -H "User-Agent: python-httpx/{httpx.__version__}"'
            ' -d "{\\"DailyCheck\\":{\\"geo\\":\\"KG\\",\\"domains\\":[\\"zazino.kg\\"]}}"'
        )

    def test_the_curl_quotes_what_a_shell_would_read(self):
        got = curl_command({"method": "POST", "url": 'https://x.example/a?b="c"&d=$e', "headers": [], "body": "a\\b`c"})
        assert got == 'curl -i -X POST "https://x.example/a?b=\\"c\\"&d=\\$e" -d "a\\\\b\\`c"'

    def test_no_curl_for_a_send_made_before_requests_were_kept(self):
        assert curl_command(None) is None and curl_command({}) is None

    def test_the_raw_answer_is_status_line_headers_and_body(self):
        sent, _ = self._send(lambda r: httpx.Response(
            403, headers={"Server": "cloudflare", "CF-RAY": "8c1f-TAS"}, text="Forbidden"))
        head, _, body = sent.raw.partition("\n\n")
        lines = head.split("\n")
        assert lines[0] == "HTTP/1.1 403 Forbidden"
        assert "server: cloudflare" in lines and "cf-ray: 8c1f-TAS" in lines
        assert body == "Forbidden"
        assert (sent.ok, sent.status_code, sent.excerpt) == (False, 403, "Forbidden")

    def test_the_token_is_kept_nowhere_even_if_the_server_echoes_it(self):
        sent, _ = self._send(lambda r: httpx.Response(
            401, headers={"X-Echo": r.headers["authorization"]}, text=f"bad token {TOKEN}"))
        kept = " ".join([sent.excerpt, sent.raw, str(sent.request), curl_command(sent.request)])
        assert TOKEN not in kept
        assert "x-echo: Bearer <token>" in sent.raw and sent.raw.endswith("bad token <token>")

    def test_a_huge_body_is_cut_and_says_so(self):
        sent, _ = self._send(lambda r: httpx.Response(500, text="x" * (RAW_BODY_LIMIT + 123)))
        body = sent.raw.partition("\n\n")[2]
        assert body.startswith("x" * RAW_BODY_LIMIT) and body.endswith("[… 123 more characters not kept]")
        assert len(sent.excerpt) == 300


class TestDailyTime:
    def test_hh_mm_only(self):
        assert valid_time("07:00") and valid_time("23:59") and valid_time("00:00")
        for bad in (None, "", "7:00", "24:00", "07:60", "0700", "07:00:00", "noon"):
            assert not valid_time(bad), bad


class TestGeos:
    """The project's GEOs, and which of them are sent (user, 2026-10-05: "first
    the user should specify all GEOs on the project page", then choose "the
    SERP domains of which GEOs to send")."""

    def test_codes_are_upper_case_two_letters_once_each_in_order(self):
        assert clean_geos(["kg", " KZ ", "kg", "uz"]) == ["KG", "KZ", "UZ"]
        assert clean_geos(["Kazakhstan", "K", "", None, "12", "ru"]) == ["RU"]
        assert clean_geos(None) == []

    def test_no_choice_means_every_project_geo(self):
        assert geos_to_send(["KG", "KZ", "UZ"], None) == ["KG", "KZ", "UZ"]
        # …including one added to the project after the choice was (not) made.
        assert geos_to_send(["KG", "KZ", "UZ", "RU"], None) == ["KG", "KZ", "UZ", "RU"]

    def test_a_choice_narrows_the_projects_geos(self):
        assert geos_to_send(["KG", "KZ", "UZ"], ["kz", "KG"]) == ["KG", "KZ"]
        assert geos_to_send(["KG", "KZ"], []) == []

    def test_a_chosen_country_that_left_the_project_is_not_sent(self):
        assert geos_to_send(["KG"], ["KG", "RU"]) == ["KG"]

    def test_only_the_allowed_countries_findings_go_out(self):
        found = {"KG": ["zazino.kg"], "KZ": ["zazino.online"], "RU": ["zazino.online"]}
        assert keep_geos(found, ["KG", "KZ"]) == {"KG": ["zazino.kg"], "KZ": ["zazino.online"]}
        assert keep_geos(found, []) == {}
