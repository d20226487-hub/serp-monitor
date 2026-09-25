from app.providers.base import shown_host


class TestShownHost:
    def test_reduces_a_displayed_breadcrumb_to_its_host(self):
        # DataForSEO's `breadcrumb` is the whole displayed address, chevrons
        # and all; only the host identifies who the result claims to be.
        assert shown_host("https://boostwin.biz › kz › promo") == "boostwin.biz"
        assert shown_host("boostwin.biz › kz") == "boostwin.biz"

    def test_accepts_a_bare_host_with_or_without_scheme(self):
        # SerpAPI's displayed_link and Oxylabs' url_shown arrive either way.
        assert shown_host("https://www.Boostwin.BIZ") == "boostwin.biz"
        assert shown_host("boostwin.biz") == "boostwin.biz"

    def test_rejects_a_site_name_that_is_not_an_address(self):
        # DataForSEO's website_name is often the site's NAME — storing
        # "Отзовик" as a host would invent a domain that does not exist.
        assert shown_host("Отзовик") is None
        assert shown_host("Some Site Name") is None
        assert shown_host("boostwin") is None      # no dot, not a host

    def test_absent_input_is_absent_output(self):
        # NULL has to mean "the provider reported nothing", never "same as the
        # link" — the whole point is telling those two apart.
        assert shown_host(None) is None
        assert shown_host("") is None
        assert shown_host("   ") is None

    def test_the_case_this_exists_for(self):
        # Google printed boostwin.biz above a link that opened the doorway.
        # The two must come out different, or the spoof is invisible.
        displayed = shown_host("https://boostwin.biz › kz")
        linked = "proceed-boostwincasino.icu"
        assert displayed == "boostwin.biz"
        assert displayed != linked
