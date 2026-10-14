"""Crontab weekdays mean what crontab means (found 2026-10-14: APScheduler read
"1-5" as Tuesday to Saturday, the "Weekdays 08:00" preset among them)."""
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from apscheduler.triggers.cron import CronTrigger

from app.crontab import to_apscheduler, weekdays

UTC = ZoneInfo("UTC")
SUNDAY = datetime(2026, 10, 18, 0, 0, tzinfo=UTC)


def fire_days(expr: str, n: int = 7) -> list[str]:
    trigger = CronTrigger.from_crontab(to_apscheduler(expr), timezone=UTC)
    out, at = [], SUNDAY
    for _ in range(n):
        at = trigger.get_next_fire_time(None, at)
        out.append(at.strftime("%a"))
        at = at.replace(second=1)
    return out


class TestWhenItFires:
    def test_one_to_five_is_monday_to_friday(self):
        assert fire_days("0 8 * * 1-5", 6) == ["Mon", "Tue", "Wed", "Thu", "Fri", "Mon"]

    def test_zero_and_seven_are_sunday(self):
        assert set(fire_days("0 23 * * 0", 3)) == {"Sun"}
        assert set(fire_days("0 23 * * 7", 3)) == {"Sun"}

    def test_a_list_and_a_step(self):
        assert fire_days("0 8 * * 1,3,5", 3) == ["Mon", "Wed", "Fri"]
        assert fire_days("0 8 * * */2", 4) == ["Sun", "Tue", "Thu", "Sat"]

    def test_names_were_always_right_and_stay_so(self):
        assert to_apscheduler("0 8 * * mon-fri") == "0 8 * * mon-fri"
        assert fire_days("0 8 * * mon-fri", 5) == ["Mon", "Tue", "Wed", "Thu", "Fri"]


class TestTheTranslation:
    def test_only_the_weekday_field_changes(self):
        assert to_apscheduler("*/15 9-18 1,15 * 1-5") == "*/15 9-18 1,15 * mon,tue,wed,thu,fri"

    def test_no_weekday_numbers_no_change(self):
        for expr in ("0 * * * *", "30 9 3 5 *", "0 9,21 * * *"):
            assert to_apscheduler(expr) == expr

    def test_every_day_written_out_is_every_day(self):
        assert to_apscheduler("0 8 * * 0-6") == "0 8 * * *"

    def test_weekdays(self):
        assert weekdays("1-5") == {1, 2, 3, 4, 5}
        assert weekdays("7") == {0} and weekdays("0,6") == {0, 6}
        assert weekdays("1/2") == {1, 3, 5, 0}

    def test_out_of_range_is_refused(self):
        for bad in ("8", "5-2", "*/0"):
            with pytest.raises(ValueError):
                weekdays(bad)
