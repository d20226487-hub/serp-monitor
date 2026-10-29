import { describe, expect, it } from "vitest";
import { customRange, previousRange, rangeFor, toInputValue } from "@/lib/date-range";

// A Wednesday, mid-month, mid-afternoon local time.
const NOW = new Date(2026, 8, 23, 15, 30, 0);  // 23 Sep 2026

function localIso(d: Date) {
  return toInputValue(d) + " " + d.toTimeString().slice(0, 8);
}

describe("rangeFor", () => {
  it("today runs from local midnight to the next one", () => {
    // Half-open: the end is the first instant of tomorrow, so a run at 23:59
    // is in and a run at 00:00 tomorrow is not.
    const r = rangeFor("today", NOW);
    expect(localIso(r.start)).toBe("2026-09-23 00:00:00");
    expect(localIso(r.end)).toBe("2026-09-24 00:00:00");
  });

  it("yesterday ends exactly where today begins", () => {
    // Consecutive presets abut, so no run can fall in both or in neither.
    const y = rangeFor("yesterday", NOW);
    const t = rangeFor("today", NOW);
    expect(y.end.getTime()).toBe(t.start.getTime());
    expect(localIso(y.start)).toBe("2026-09-22 00:00:00");
  });

  it("this week starts on Monday", () => {
    // CIS markets: a Sunday-based week would put yesterday in last week for
    // most of the week.
    const r = rangeFor("week", NOW);
    expect(localIso(r.start)).toBe("2026-09-21 00:00:00");   // Monday
    expect(r.start.getDay()).toBe(1);
  });

  it("this week on a Sunday still reaches back to Monday", () => {
    const sunday = new Date(2026, 8, 27, 9, 0, 0);
    const r = rangeFor("week", sunday);
    expect(localIso(r.start)).toBe("2026-09-21 00:00:00");
    expect(localIso(r.end)).toBe("2026-09-28 00:00:00");
  });

  it("this month is the calendar month to date", () => {
    const r = rangeFor("month", NOW);
    expect(localIso(r.start)).toBe("2026-09-01 00:00:00");
    expect(localIso(r.end)).toBe("2026-09-24 00:00:00");
  });

  it("this year is the calendar year to date", () => {
    const r = rangeFor("year", NOW);
    expect(localIso(r.start)).toBe("2026-01-01 00:00:00");
    expect(localIso(r.end)).toBe("2026-09-24 00:00:00");
  });

  it("this year on 1 January is a single day so far", () => {
    // The boundary case: a year-to-date window on its first day must not
    // reach back into last year.
    const newYear = new Date(2026, 0, 1, 8, 0, 0);
    const r = rangeFor("year", newYear);
    expect(localIso(r.start)).toBe("2026-01-01 00:00:00");
    expect(localIso(r.end)).toBe("2026-01-02 00:00:00");
  });

  it("sends UTC, having computed the window locally", () => {
    // The whole point: "today" is a claim about the clock in front of you, but
    // run timestamps are UTC, so the boundary converts rather than being taken
    // from a UTC midnight.
    const r = rangeFor("today", NOW);
    expect(r.start.toISOString()).toBe(new Date(2026, 8, 23, 0, 0, 0).toISOString());
  });
});

describe("customRange", () => {
  it("includes the day the reader picked as the end", () => {
    // The picker shows "to 25 Sep"; a run at 25 Sep 18:00 has to be in it.
    const r = customRange("2026-09-20", "2026-09-25")!;
    expect(localIso(r.start)).toBe("2026-09-20 00:00:00");
    expect(localIso(r.end)).toBe("2026-09-26 00:00:00");
  });

  it("a single day is a valid range", () => {
    const r = customRange("2026-09-20", "2026-09-20")!;
    expect(r.end.getTime() - r.start.getTime()).toBe(24 * 3600 * 1000);
  });

  it("refuses an incomplete or backwards pair", () => {
    // Nothing should be queried while half a range is typed.
    expect(customRange("", "2026-09-25")).toBeNull();
    expect(customRange("2026-09-25", "")).toBeNull();
    expect(customRange("2026-09-25", "2026-09-20")).toBeNull();
  });
});

describe("toInputValue", () => {
  it("uses the local date, not the UTC one", () => {
    // toISOString().slice(0,10) is the classic off-by-one-day bug for anyone
    // not on UTC; late-evening dates are the ones that break.
    const lateEvening = new Date(2026, 8, 23, 23, 30, 0);
    expect(toInputValue(lateEvening)).toBe("2026-09-23");
  });
});

describe("previousRange", () => {
  const prev = (preset: Parameters<typeof rangeFor>[0]) => {
    const r = previousRange(preset, rangeFor(preset, NOW), NOW);
    return [localIso(r.start), localIso(r.end)];
  };

  it("today is compared with yesterday, yesterday with the day before", () => {
    expect(prev("today")).toEqual(["2026-09-22 00:00:00", "2026-09-23 00:00:00"]);
    expect(prev("yesterday")).toEqual(["2026-09-21 00:00:00", "2026-09-22 00:00:00"]);
  });

  it("this week with the whole of last week, Monday to Monday", () => {
    expect(prev("week")).toEqual(["2026-09-14 00:00:00", "2026-09-21 00:00:00"]);
  });

  it("this month with the whole of last month, this year with last year", () => {
    expect(prev("month")).toEqual(["2026-08-01 00:00:00", "2026-09-01 00:00:00"]);
    expect(prev("year")).toEqual(["2025-01-01 00:00:00", "2026-01-01 00:00:00"]);
  });

  it("a custom range with as many days just before it", () => {
    const custom = customRange("2026-10-12", "2026-10-18")!;
    const r = previousRange("custom", custom, NOW);
    expect([localIso(r.start), localIso(r.end)]).toEqual(["2026-10-05 00:00:00", "2026-10-12 00:00:00"]);
  });

  it("January is compared with December of the year before", () => {
    const jan = new Date(2026, 0, 15, 12, 0, 0);
    const r = previousRange("month", rangeFor("month", jan), jan);
    expect([localIso(r.start), localIso(r.end)]).toEqual(["2025-12-01 00:00:00", "2026-01-01 00:00:00"]);
  });
});
