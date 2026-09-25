from app.routers.project_positions import average_position, mixed_providers


class TestAveragePosition:
    def test_averages_the_runs_it_has(self):
        stat = average_position([3, 5, 4], runs=3)
        assert stat.average == 4.0
        assert (stat.best, stat.worst) == (3, 5)
        assert (stat.ranked_in, stat.runs) == (3, 3)

    def test_an_absence_is_counted_not_averaged_in(self):
        # Ranked #3 twice out of ten measurements. The average is 3.0 — the
        # eight absences have no position to contribute — but the row has to
        # carry "2 of 10", or a domain that shows up twice a month reads
        # exactly like one that holds #3 every single day.
        stat = average_position([3, 3], runs=10)
        assert stat.average == 3.0
        assert (stat.ranked_in, stat.runs) == (2, 10)
        assert (stat.present_pct, stat.absent_pct) == (20.0, 80.0)

    def test_visibility_always_adds_up_to_a_hundred(self):
        # Absent is taken from the rounded present share, not computed again,
        # so a third and two thirds read as 33.3 and 66.7 rather than as a pair
        # that visibly fails to make 100.
        for ranked, runs in [(1, 3), (2, 3), (1, 7), (6, 7), (1, 6)]:
            stat = average_position([1] * ranked, runs=runs)
            assert stat.present_pct + stat.absent_pct == 100.0

    def test_present_in_every_run(self):
        stat = average_position([2, 2, 2], runs=3)
        assert (stat.present_pct, stat.absent_pct) == (100.0, 0.0)

    def test_rounds_to_one_decimal(self):
        # Same precision the analyzer's opportunity score prints at. A mean of
        # 4.333… is spurious precision on a number sampled a handful of times.
        assert average_position([4, 4, 5], runs=3).average == 4.3
        assert average_position([1, 2], runs=2).average == 1.5

    def test_never_ranked_has_no_average(self):
        # None, not 0 and not the captured depth: there is no number for "was
        # not on the page", and inventing one would make the figure depend on
        # how deep we happened to scrape.
        assert average_position([], runs=9) is None

    def test_believes_the_readings_over_the_denominator(self):
        # Coverage and results disagreeing means something is off, but printing
        # "3 of 2" is worse than quietly widening the denominator.
        stat = average_position([1, 2, 3], runs=2)
        assert (stat.ranked_in, stat.runs) == (3, 3)
        assert stat.present_pct == 100.0


class TestMixedProviders:
    def test_one_provider_is_not_a_mix(self):
        assert mixed_providers(["dataforseo", "dataforseo"]) is False

    def test_two_providers_are(self):
        # rank_absolute against organic-only rank: the same slot on the same
        # page is #9 to one and #7 to the other, so the mean is a number no
        # page ever showed.
        assert mixed_providers(["dataforseo", "serpapi"]) is True

    def test_unknown_is_not_a_second_provider(self):
        # NULL is "recorded before we stored this", not "someone else". A mix
        # we cannot prove is not a mix we should claim.
        assert mixed_providers([None, None]) is False
        assert mixed_providers(["serpapi", None]) is False

    def test_unknown_alongside_a_real_mix_still_flags(self):
        assert mixed_providers(["serpapi", None, "oxylabs"]) is True

    def test_nothing_at_all(self):
        assert mixed_providers([]) is False
