from app.providers.domain_paste import (
    clean_domain_list, normalize_domain, parse_domains,
)


class TestNormalizeDomain:
    def test_strips_everything_that_is_not_the_host(self):
        for raw in [
            "https://example.com/path?q=1",
            "http://www.example.com",
            "WWW.Example.COM",
            "example.com:8443",
            "  example.com/  ",
            "user:pw@example.com",
        ]:
            assert normalize_domain(raw) == "example.com", raw

    def test_keeps_subdomains(self):
        # kz.example.com and example.com are different targets — a doorway on a
        # subdomain is exactly what this tool watches for.
        assert normalize_domain("https://kz.example.com/") == "kz.example.com"
        assert normalize_domain("m.parimatch.kz") == "m.parimatch.kz"

    def test_accepts_unknown_tlds(self):
        # New gTLDs keep appearing, and rejecting one would silently drop the
        # doorway domains that matter most here.
        assert normalize_domain("boostwin.lol") == "boostwin.lol"
        assert normalize_domain("some-thing.xn--p1ai") == "some-thing.xn--p1ai"

    def test_rejects_what_is_not_a_host(self):
        for raw in ["", "   ", "not a domain", "localhost", "example", "..", "-.com"]:
            assert normalize_domain(raw) is None, raw


class TestParseDomains:
    def test_accepts_any_separator_one_paste_might_use(self):
        good, bad = parse_domains("a.com\nb.com, c.com;d.com\te.com|f.com")
        assert good == ["a.com", "b.com", "c.com", "d.com", "e.com", "f.com"]
        assert bad == []

    def test_keeps_pasted_order_and_drops_repeats(self):
        # A list someone arranged by importance comes back arranged the same
        # way; the duplicate is the same host under two spellings.
        good, _ = parse_domains("zeta.com\nalpha.com\nhttps://www.ZETA.com/x")
        assert good == ["zeta.com", "alpha.com"]

    def test_reports_rejects_rather_than_dropping_them_silently(self):
        good, bad = parse_domains("good.com\nnonsense\nalso-good.net")
        assert good == ["good.com", "also-good.net"]
        assert bad == ["nonsense"]

    def test_empty_paste(self):
        assert parse_domains("") == ([], [])
        assert parse_domains("   \n  \n") == ([], [])


class TestCleanDomainList:
    def test_normalises_a_list_that_did_not_come_from_the_form(self):
        # The API is not only driven by our own UI, and a domain stored with a
        # scheme would never match a SERP host at tracking time.
        assert clean_domain_list(
            ["https://A.com/", "www.a.com", "b.com", "junk", None]
        ) == ["a.com", "b.com"]

    def test_none_is_empty(self):
        assert clean_domain_list(None) == []
