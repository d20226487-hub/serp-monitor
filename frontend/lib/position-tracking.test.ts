import { describe, expect, it } from "vitest";
import type { TrackingRow, TrackingSerp } from "@/lib/api";
import { NO_FILTERS, bandCount, bandStart, changeOf, spanOf, dropped, droppedKeywords, keep, serpExtras, sorted, visible } from "@/lib/position-tracking";

const SERP: TrackingSerp = {
  engine: "google", device: "mobile", country_code: "kz", language: "ru", location: "Almaty,Almaty,Kazakhstan",
  google_domain: "google.kz", key: "kz", keywords: 1, depth: 10, now: {}, before: null, before_check: null, keywords_best: [],
};

function row(over: Partial<TrackingRow>): TrackingRow {
  return {
    serp: "kz", keyword: "casino", url: "https://site-one.example/", domain: "site-one.example", amp_of: null,
    position: 3, checked_at: "2026-10-29T07:00:00", best: 3, average: 3, position_sum: 3, checks: 1, ranked_in: 1, readings: [],
    previous_check: null, previous_period: null, ...over,
  };
}
const at = (position: number | null) => ({ at: "2026-10-28T07:00:00", position });

describe("changeOf", () => {
  it("places gained or lost against the previous check", () => {
    expect(changeOf(row({ position: 2, previous_check: at(5) }), "check")).toEqual({ kind: "up", delta: 3, was: 5 });
    expect(changeOf(row({ position: 7, previous_check: at(5) }), "check")).toEqual({ kind: "down", delta: -2, was: 5 });
    expect(changeOf(row({ position: 5, previous_check: at(5) }), "check").kind).toBe("same");
  });

  it("new when it was not on that page, lost when it is not on this one", () => {
    expect(changeOf(row({ position: 4, previous_check: at(null) }), "check").kind).toBe("new");
    expect(changeOf(row({ position: null, best: null, previous_check: at(6) }), "check")).toEqual({ kind: "lost", delta: null, was: 6 });
  });

  it("nothing to say when the keyword had no such check", () => {
    expect(changeOf(row({ position: 4 }), "check").kind).toBe("none");
  });

  it("against the previous period when asked", () => {
    const r = row({ position: 2, previous_check: at(2), previous_period: at(9) });
    expect(changeOf(r, "check").kind).toBe("same");
    expect(changeOf(r, "period")).toEqual({ kind: "up", delta: 7, was: 9 });
  });
});

describe("which rows show", () => {
  it("a URL that dropped out shows only under the comparison that knew it", () => {
    const gone = row({ position: null, best: null, previous_check: at(4), previous_period: at(null) });
    expect(visible(gone, "check")).toBe(true);
    expect(visible(gone, "period")).toBe(false);
  });

  it("filters by engine, GEO, top N, change and text", () => {
    const r = row({ position: 4, previous_check: at(6) });
    expect(keep(r, SERP, NO_FILTERS)).toBe(true);
    expect(keep(r, SERP, { ...NO_FILTERS, engine: "yandex" })).toBe(false);
    expect(keep(r, SERP, { ...NO_FILTERS, geo: "KZ" })).toBe(true);
    expect(keep(r, SERP, { ...NO_FILTERS, top: 3 })).toBe(false);
    expect(keep(r, SERP, { ...NO_FILTERS, top: 5 })).toBe(true);
    expect(keep(r, SERP, { ...NO_FILTERS, change: "up" })).toBe(true);
    expect(keep(r, SERP, { ...NO_FILTERS, change: "down" })).toBe(false);
    expect(keep(r, SERP, { ...NO_FILTERS, query: "CASI" })).toBe(true);
    expect(keep(r, SERP, { ...NO_FILTERS, query: "site-one" })).toBe(true);
    expect(keep(r, SERP, { ...NO_FILTERS, query: "bonus" })).toBe(false);
  });
});

describe("sorted", () => {
  const rows = [
    row({ keyword: "b", position: 5, previous_check: at(1) }),
    row({ keyword: "a", position: null, best: 2, previous_check: at(3) }),
    row({ keyword: "c", position: 1, previous_check: at(null) }),
  ];
  const serpOf = () => SERP;

  it("by position, empty ones last either way", () => {
    expect(sorted(rows, { column: "position", descending: false }, "check", serpOf).map(r => r.keyword)).toEqual(["c", "b", "a"]);
    expect(sorted(rows, { column: "position", descending: true }, "check", serpOf).map(r => r.keyword)).toEqual(["b", "c", "a"]);
  });

  it("by change: a new URL above any gain, a lost one below any drop", () => {
    expect(sorted(rows, { column: "change", descending: true }, "check", serpOf).map(r => r.keyword)).toEqual(["c", "b", "a"]);
  });
});

describe("serpExtras", () => {
  it("nothing for the only SERP of its engine and country", () => {
    expect(serpExtras(SERP, [SERP])).toEqual([]);
  });

  it("what tells two of them apart", () => {
    const com = { ...SERP, google_domain: "google.com", key: "kz2" };
    expect(serpExtras(SERP, [SERP, com])).toEqual(["google.kz"]);
    const astana = { ...SERP, location: "Astana,Astana,Kazakhstan", key: "kz3" };
    expect(serpExtras(astana, [SERP, astana])).toEqual(["Astana"]);
  });
});

describe("dropped", () => {
  const kw = (keyword: string, had = true) =>
    ({ keyword, now: null, had_check: had, check: null, had_period: false, period: null });
  const url = (keyword: string, url: string, now: number | null, was: number | null) =>
    row({ keyword, url, position: now, best: now, previous_check: at(was) });

  it("only a URL that left the page, not one that moved down", () => {
    const rows = [
      url("gone", "https://site-one.example/a", null, 2),   // left the SERP
      url("fell", "https://site-one.example/b", 9, 2),      // only lower: not counted
      url("held", "https://site-one.example/c", 1, 1),
    ];
    const kws = [kw("gone"), kw("fell"), kw("held")];
    expect(dropped(rows, kws, 2, 3, "check")).toEqual([{ keyword: "gone", url: "https://site-one.example/a", was: 2 }]);
    expect(dropped(rows, kws, 1, 1, "check")).toEqual([]);
  });

  it("each band holds its own places, so a URL is counted once", () => {
    const rows = [url("a", "https://site-one.example/a", null, 1), url("b", "https://site-one.example/b", null, 15)];
    const kws = [kw("a"), kw("b")];
    const tops = [1, 3, 5, 10, 20, 30, 50, 100];
    const counts = tops.map(n => droppedKeywords(dropped(rows, kws, bandStart(n, tops), n, "check")!));
    expect(counts).toEqual([1, 0, 0, 0, 1, 0, 0, 0]);
  });

  it("two URLs of one keyword leaving one band are one keyword", () => {
    const rows = [url("gone", "https://site-one.example/a", null, 7), url("gone", "https://site-two.example/", null, 9)];
    const found = dropped(rows, [kw("gone")], 6, 10, "check")!;
    expect(found.map(d => d.url)).toEqual(["https://site-one.example/a", "https://site-two.example/"]);
    expect(droppedKeywords(found)).toBe(1);
  });

  it("nothing to say without a check to compare with", () => {
    expect(dropped([url("new", "https://site-one.example/", 1, null)], [kw("new", false)], 1, 3, "check")).toBeNull();
    expect(dropped([], [kw("gone")], 1, 3, "period")).toBeNull();
  });
});

describe("bandCount", () => {
  it("each band from the cumulative tops: #1, #2–3, #4–5, #6–10 …", () => {
    const tops = [1, 3, 5, 10, 20, 30, 50, 100];
    // Positions #1, #4, #9 and #9 again: in the top 1, 3, 5, 10 … 1, 1, 2, 4, 4 …
    const cumulative = { "1": 1, "3": 1, "5": 2, "10": 4, "20": 4, "30": 4, "50": 4, "100": 4 };
    expect(tops.map(n => bandCount(cumulative, n, tops))).toEqual([1, 0, 1, 2, 0, 0, 0, 0]);
  });
});

describe("spanOf", () => {
  const today = { at: "2026-10-29T03:20:00", position: 15 };

  it("one check today, compared with yesterday's: yesterday's counts too", () => {
    // The user's row: #20 on the 28th, #15 today — change +5.
    const r = row({ position: 15, best: 15, average: 15, position_sum: 15, checks: 1, ranked_in: 1, readings: [today],
      previous_check: at(20) });
    const span = spanOf(r, "check");
    expect([span.best, span.average, span.rankedIn, span.checks]).toEqual([15, 17.5, 2, 2]);
    expect(span.readings.map(p => p.position)).toEqual([20, 15]);
    expect(changeOf(r, "check").delta).toBe(5);
  });

  it("several checks in the period: the previous one is already among them", () => {
    const r = row({ position: 2, best: 2, average: 3, position_sum: 6, checks: 2, ranked_in: 2, previous_check: at(4) });
    expect(spanOf(r, "check").average).toBe(3);
  });

  it("the previous period's check is always added; an absence is not a position", () => {
    const r = row({ position: 6, best: 6, average: 7, position_sum: 14, checks: 2, ranked_in: 2, previous_period: at(1) });
    expect([spanOf(r, "period").best, spanOf(r, "period").average]).toEqual([1, 5]);
    const absent = row({ position: 6, best: 6, average: 6, position_sum: 6, previous_period: at(null) });
    expect([spanOf(absent, "period").average, spanOf(absent, "period").checks]).toEqual([6, 2]);
  });
});
