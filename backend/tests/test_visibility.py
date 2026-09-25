from app.visibility import (
    DEFAULT_WEIGHTS, cumulative, page_total, share, visibility,
)


class TestDefaults:
    def test_the_defaults_are_the_agreed_curve(self):
        assert DEFAULT_WEIGHTS == [50, 20, 10, 7, 5, 3, 2, 1, 1, 1]

    def test_they_sum_to_a_hundred(self):
        # Not required by the arithmetic — every figure is divided by the total
        # in play — but it makes the running totals read as percentages.
        assert sum(DEFAULT_WEIGHTS) == 100

    def test_running_totals_are_the_familiar_column(self):
        assert cumulative(DEFAULT_WEIGHTS) == [50, 70, 80, 87, 92, 95, 97, 98, 99, 100]


class TestShare:
    def test_a_full_page_scores_straight_off_the_table(self):
        assert share(1, depth=10) == 50.0
        assert share(2, depth=10) == 20.0
        assert share(10, depth=10) == 1.0

    def test_a_short_page_redistributes_what_is_not_there(self):
        # Seven results mean slots 8-10 do not exist, so the attention that
        # would have gone to them is spread over the seven that do: the
        # denominator is 97, not 100, and every slot is worth a shade more.
        assert round(share(1, depth=7), 2) == 51.55
        assert round(share(7, depth=7), 2) == 2.06
        # And the whole page still adds up to exactly one page.
        assert round(sum(share(p, 7) for p in range(1, 8)), 6) == 100.0

    def test_a_single_result_page_is_the_whole_page(self):
        assert share(1, depth=1) == 100.0

    def test_depth_past_the_table_does_not_dilute_the_top(self):
        # Scraping a hundred results must not make #1 worth less than it is on
        # a page of ten: the weights define where visibility stops.
        assert share(1, depth=100) == 50.0
        assert share(11, depth=100) == 0.0

    def test_a_gap_is_not_redistributed(self):
        # rank_absolute leaves holes where ads and AI blocks sat. That
        # attention went to the ad, so scoring against the depth reached — not
        # against the positions present — leaves it out of everyone's share.
        # Eight organic results spanning 1..10 still divide by 100.
        present = [1, 2, 4, 5, 6, 8, 9, 10]
        assert share(4, depth=10) == 7.0
        assert round(sum(share(p, 10) for p in present), 6) == 88.0

    def test_a_position_deeper_than_the_stated_depth_is_believed(self):
        # Never divide by a total that excludes the slot being scored.
        assert share(5, depth=3) == share(5, depth=5)

    def test_nonsense_positions_score_nothing(self):
        assert share(0, depth=10) == 0.0
        assert share(-1, depth=10) == 0.0
        assert share(99, depth=99) == 0.0


class TestPageTotal:
    def test_an_empty_page_has_nothing_in_play(self):
        assert page_total(0, DEFAULT_WEIGHTS) == 0.0

    def test_no_weights_means_no_visibility_rather_than_a_crash(self):
        assert page_total(10, []) == 0.0
        assert share(1, 10, []) == 0.0


class TestVisibility:
    def test_always_first_is_the_full_weight_of_first(self):
        assert visibility([(1, 10)] * 4, runs=4) == 50.0

    def test_an_absence_drags_it_down(self):
        # #1, but only on one run in four. Being unmissable a quarter of the
        # time is a quarter of the visibility.
        assert visibility([(1, 10)], runs=4) == 12.5

    def test_this_is_why_the_metric_exists(self):
        # #1 on a quarter of the runs against #4 on every one of them. Average
        # position says the first is far better (1.0 against 4.0) and presence
        # says the second is (25% against 100%); only visibility puts the two
        # on one scale — and here the steady one wins.
        flashy = visibility([(1, 10)], runs=4)
        steady = visibility([(4, 10)] * 4, runs=4)
        assert flashy == 12.5
        assert steady == 7.0
        assert flashy > steady

    def test_never_ranked_is_nothing(self):
        assert visibility([], runs=9) == 0.0

    def test_a_short_page_lifts_the_score(self):
        # Same slot, same presence, smaller page: worth more.
        assert visibility([(1, 7)], runs=1) > visibility([(1, 10)], runs=1)

    def test_custom_weights_are_honoured(self):
        # A flat table says every slot on the page is worth the same.
        assert visibility([(1, 4)], runs=1, weights=[1, 1, 1, 1]) == 25.0
        assert visibility([(4, 4)], runs=1, weights=[1, 1, 1, 1]) == 25.0
