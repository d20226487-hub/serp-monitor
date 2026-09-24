import json

from app.search import contains_ci


class TestContainsCi:
    def test_finds_a_cyrillic_keyword_stored_ascii_escaped(self):
        # This is the real failure: SQLAlchemy's JSON type writes
        # ensure_ascii=True, so the column holds no Cyrillic at all and no LIKE
        # pattern typed in Russian could ever match it.
        stored = json.dumps(["boostwin", "буствин"])
        assert "буствин" not in stored          # the bug, in one line
        assert contains_ci(stored, "буствин") == 1

    def test_folds_case_in_cyrillic(self):
        # SQLite's own lower() is ASCII-only in this build, so this is the
        # other half of why the search came back empty.
        assert contains_ci(json.dumps(["Буствин"]), "буствин") == 1
        assert contains_ci("Буствин Казино", "БУСТВИН") == 1

    def test_still_matches_latin_and_partial_words(self):
        stored = json.dumps(["boostwin казино", "melbet"])
        assert contains_ci(stored, "MELBET") == 1
        assert contains_ci(stored, "boost") == 1
        assert contains_ci(stored, "казино") == 1

    def test_searches_a_plain_name_column_too(self):
        # One function covers both columns; a name is not JSON and falls
        # through to being searched as-is.
        assert contains_ci("BrandSteal - top KZ casino brands", "kz") == 1
        assert contains_ci("Отслеживание бренда", "бренд") == 1

    def test_misses_are_misses(self):
        stored = json.dumps(["boostwin", "буствин"])
        assert contains_ci(stored, "parimatch") == 0
        assert contains_ci(stored, "бустви н") == 0

    def test_empty_and_null_inputs(self):
        assert contains_ci(None, "x") == 0
        assert contains_ci("anything", None) == 0
        assert contains_ci("anything", "   ") == 0

    def test_a_name_that_happens_to_be_valid_json(self):
        # "123" parses as a JSON scalar; searching it must not explode or
        # silently stop matching.
        assert contains_ci("123", "12") == 1
