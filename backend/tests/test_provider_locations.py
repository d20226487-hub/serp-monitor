from app.provider_locations import Loc, choose, pick_serpapi_id, region_key
from app.routers.locations import one_per_place

ALMATY = Loc(9063099, "Almaty,Almaty Region,Kazakhstan", "KZ", "City")
ALMATY_CITY_REGION = Loc(9235214, "Almaty,Kazakhstan", "KZ", "City")
ALMATY_REGION = Loc(9070290, "Almaty Region,Kazakhstan", "KZ", "Province")
OLD_ALMATY = {"canonical_name": "Almaty,Almaty Province,Kazakhstan", "country_code": "kz", "target_type": "City"}


class TestRegionKey:
    def test_a_renamed_region_is_the_same_region(self):
        assert region_key("Almaty,Almaty Province,Kazakhstan") == region_key("Almaty,Almaty Region,Kazakhstan") == "almaty"

    def test_no_region_at_all(self):
        assert region_key("Almaty,Kazakhstan") == ""
        assert region_key("Kazakhstan") == ""


class TestChoose:
    """Which of the provider's same-named entries a job's location is, when
    only names can say."""

    def test_the_one_city_of_that_name_in_the_country(self):
        assert choose(OLD_ALMATY, [ALMATY, ALMATY_REGION]) == ALMATY

    def test_twice_listed_city_is_told_apart_by_its_region(self):
        # The case that failed (2026-10-05): DataForSEO lists Almaty both
        # inside Almaty Region and as a city-region of its own. The job's
        # "…Almaty Province…" is the first: same region, renamed.
        assert choose(OLD_ALMATY, [ALMATY_CITY_REGION, ALMATY]) == ALMATY

    def test_a_city_is_not_the_district_that_shares_its_name(self):
        district = Loc(9196209, "Almaty,Some District,Kazakhstan", "KZ", "District")
        assert choose(OLD_ALMATY, [district]) is None
        assert choose(OLD_ALMATY, [district, ALMATY]) == ALMATY

    def test_two_cities_of_one_name_are_not_guessed_between(self):
        # Searching the wrong Springfield would look exactly like success.
        a = Loc(1, "Springfield,Illinois,United States", "US", "City")
        b = Loc(2, "Springfield,Missouri,United States", "US", "City")
        ref = {"canonical_name": "Springfield,Massachusetts,United States", "country_code": "us", "target_type": "City"}
        assert choose(ref, [a, b]) is None
        # …but the one in the job's own state is found.
        assert choose({**ref, "canonical_name": "Springfield,Missouri,United States"}, [a, b]) == b

    def test_a_stale_region_that_matches_neither_is_left_to_the_id_lookup(self):
        # "Shymkent,South Kazakhstan Province,Kazakhstan" against DataForSEO's
        # two Shymkents: names cannot decide; SerpAPI's ID does (see below).
        a = Loc(1009809, "Shymkent,Shymkent,Kazakhstan", "KZ", "City")
        b = Loc(9252550, "Shymkent,Kazakhstan", "KZ", "City")
        ref = {"canonical_name": "Shymkent,South Kazakhstan Province,Kazakhstan", "country_code": "kz", "target_type": "City"}
        assert choose(ref, [a, b]) is None

    def test_nothing_of_that_name(self):
        assert choose({"canonical_name": "Atlantis"}, []) is None


class TestSerpapiId:
    """Google's ID for a location, from what SerpAPI's list answered."""

    def test_the_row_carrying_that_very_name(self):
        rows = [
            {"canonical_name": "Taldykorgan,Almaty Province,Kazakhstan", "google_id": 9063093, "country_code": "KZ", "target_type": "City"},
            {"canonical_name": "Almaty,Almaty Province,Kazakhstan", "google_id": 9063099, "country_code": "KZ", "target_type": "City"},
        ]
        assert pick_serpapi_id(OLD_ALMATY, rows, []) == 9063099

    def test_a_name_serpapi_no_longer_serves_is_found_by_its_city(self):
        # Measured: the full stale name returns nothing; "Shymkent" alone
        # returns the one city, whose ID is DataForSEO's Shymkent.
        ref = {"canonical_name": "Shymkent,South Kazakhstan Province,Kazakhstan", "country_code": "kz", "target_type": "City"}
        head = [{"canonical_name": "Shymkent,Kazakhstan", "google_id": 1009809, "country_code": "KZ", "target_type": "City"}]
        assert pick_serpapi_id(ref, [], head) == 1009809

    def test_two_places_of_that_name_are_not_guessed_between(self):
        ref = {"canonical_name": "Springfield,Nowhere,United States", "country_code": "us", "target_type": "City"}
        head = [
            {"canonical_name": "Springfield,Illinois,United States", "google_id": 1, "country_code": "US", "target_type": "City"},
            {"canonical_name": "Springfield,Missouri,United States", "google_id": 2, "country_code": "US", "target_type": "City"},
        ]
        assert pick_serpapi_id(ref, [], head) is None

    def test_another_countrys_or_another_types_namesake_does_not_count(self):
        ref = {"canonical_name": "Moscow,Russia", "country_code": "ru", "target_type": "City"}
        head = [
            {"canonical_name": "Moscow,Idaho,United States", "google_id": 5, "country_code": "US", "target_type": "City"},
            {"canonical_name": "Moscow,Russia", "google_id": 6, "country_code": "RU", "target_type": "Region"},
            {"canonical_name": "Moscow,Moscow,Russia", "google_id": 1011969, "country_code": "RU", "target_type": "City"},
        ]
        assert pick_serpapi_id(ref, [], head) == 1011969


class TestOnePerPlace:
    def test_keeps_the_current_name_of_a_renamed_place(self):
        # SerpAPI serves both; the one with a reach figure is the live name.
        old = {"canonical_name": "Almaty,Almaty Province,Kazakhstan", "google_id": 9063099, "reach": None}
        new = {"canonical_name": "Almaty,Almaty Region,Kazakhstan", "google_id": 9063099, "reach": 3470000}
        other = {"canonical_name": "Taldykorgan,Almaty Province,Kazakhstan", "google_id": 9063093, "reach": None}
        assert one_per_place([old, other, new]) == [new, other]
        assert one_per_place([new, old, other]) == [new, other]

    def test_rows_without_an_id_are_all_kept(self):
        a = {"canonical_name": "A", "google_id": None, "reach": None}
        b = {"canonical_name": "B", "google_id": None, "reach": None}
        assert one_per_place([a, b]) == [a, b]


class TestLists:
    """Which mirrored list each provider's locations come from."""

    def test_bright_data_and_oxylabs_share_googles_list(self):
        from app.provider_locations import lists_for
        assert lists_for(["brightdata"]) == ["google"]
        assert lists_for(["oxylabs", "brightdata"]) == ["google"]
        assert lists_for(["dataforseo", "oxylabs"]) == ["dataforseo", "google"]

    def test_serpapi_has_no_mirror(self):
        # Its list is its live search; nothing to check it against locally.
        from app.provider_locations import lists_for
        assert lists_for(["serpapi"]) == []
        assert lists_for([]) == []


class TestGoogleGeotargets:
    def test_the_newest_dated_file_on_the_page(self):
        from app.provider_locations import latest_geotargets_url
        page = ('<a href="/static/google-ads/api/data/geo/geotargets-2026-07-16.csv.zip">July</a>'
                '<a href="/static/google-ads/api/data/geo/geotargets-2026-08-12.csv.zip">August</a>'
                '<a href="/static/google-ads/api/data/geo/geotargets-2026-07-16.csv.zip">July again</a>')
        assert latest_geotargets_url(page) == (
            "https://developers.google.com/static/google-ads/api/data/geo/geotargets-2026-08-12.csv.zip")
        assert latest_geotargets_url("<p>no file here</p>") is None

    def test_rows_of_the_csv(self):
        from app.provider_locations import parse_geotargets
        text = ("Criteria ID,Name,Canonical Name,Parent ID,Country Code,Target Type,Status\n"
                '9063099,Almaty,"Almaty,Almaty Region,Kazakhstan",9070290,KZ,City,Active\n'
                "2398,Kazakhstan,Kazakhstan,,KZ,Country,Active\n"
                '1,Gone,"Gone,Nowhere",,XX,City,Removal Planned\n'
                ",,,,,,\n")
        rows = parse_geotargets(text)
        assert rows[0] == {"code": 9063099, "name": "Almaty,Almaty Region,Kazakhstan",
                           "country_code": "KZ", "location_type": "City"}
        # Still searchable until Google removes it, so still listed.
        assert [r["code"] for r in rows] == [9063099, 2398, 1]


class TestSearchOrder:
    def test_the_place_named_what_was_typed_comes_first(self):
        from app.provider_locations import rank
        places = [
            Loc(9229937, "Esik,Almaty Region,Kazakhstan", "KZ", "City"),
            Loc(9070290, "Almaty Region,Kazakhstan", "KZ", "Province"),
            Loc(9063099, "Almaty,Almaty Region,Kazakhstan", "KZ", "City"),
            Loc(9235214, "Almaty,Kazakhstan", "KZ", "City"),
        ]
        ordered = [p.name for p in sorted(places, key=lambda p: rank("almaty", p))]
        assert ordered == ["Almaty,Kazakhstan", "Almaty,Almaty Region,Kazakhstan",
                           "Almaty Region,Kazakhstan", "Esik,Almaty Region,Kazakhstan"]

    def test_a_region_of_that_name_before_cities_of_that_name(self):
        from app.provider_locations import rank
        region = Loc(20950, "Moscow,Russia", "RU", "Region")
        city = Loc(1011969, "Moscow,Moscow,Russia", "RU", "City")
        postcode = Loc(5, "Moscow 101000,Russia", "RU", "Postal Code")
        assert sorted([postcode, city, region], key=lambda p: rank("moscow", p)) == [region, city, postcode]

    def test_the_bigger_namesake_first_when_its_size_is_known(self):
        from app.provider_locations import rank
        idaho = Loc(1, "Paris,Idaho,United States", "US", "City")
        france = Loc(2, "Paris,Ile-de-France,France", "FR", "City")
        assert sorted([idaho, france], key=lambda p: rank("paris", p)) == [idaho, france]      # by name alone
        assert sorted([idaho, france], key=lambda p: rank("paris", p, {2: 12_000_000})) == [france, idaho]
