import { describe, expect, it } from "vitest";
import { customRange, rangeFor, toInputValue } from "@/lib/date-range";

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
