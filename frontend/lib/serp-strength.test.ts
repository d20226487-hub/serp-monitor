import { describe, expect, it } from "vitest";
import { AnalysisUrl } from "@/lib/api";
import {
  bandCounts,
  bandOf,
  barHeight,
  cohortAverage,
  cohortSizeFor,
  ladderDriver,
  runCeiling,
  weakestCohort,
  weaknessRanker,
  withinDepth,
} from "@/lib/serp-strength";

/** Minimal AnalysisUrl for the fields this module actually reads. */
function u(
  position: number,
  ur: number | null,
  dr: number | null,
  domain = `d${position}.com`,
  extra: Record<string, number | null> = {},
  analysed = true,
): AnalysisUrl {
  return {
    url: `https://${domain}/p${position}`,
    analyzed_url: `https://${domain}/p${position}`,
    normalized: false,
    position,
    positions: [position],
    domain,
    metrics: { url_rating: ur, domain_rating: dr, ...extra },
    error: false,
    analysed,
  };
}

const R = "domain_rating";

// The real shape of run 66's SERP, which is what these rules were designed
// against. boostcasino.com holds BOTH #7 and #8 at the same DR.
const RUN66: AnalysisUrl[] = [
  u(1, 0, 77, "liga.net", { backlinks_dofollow: 0, refdomains_dofollow: 0 }),
  u(2, 4.8, 25, "kzboostwin.net", { backlinks_dofollow: 1407, refdomains_dofollow: 387 }),
  u(3, 10, 47, "policecontrol.info", { backlinks_dofollow: 17108, refdomains_dofollow: 5340 }),
  u(4, 6, 76, "by.tribuna.com", { backlinks_dofollow: 0, refdomains_dofollow: 0 }),
  u(5, 4.6, 7, "kzboost-win.org", { backlinks_dofollow: 423, refdomains_dofollow: 309 }),
  u(7, 6, 72, "boostcasino.com", { backlinks_dofollow: 2, refdomains_dofollow: 1 }),
  u(8, 7, 72, "boostcasino.com", { backlinks_dofollow: 1, refdomains_dofollow: 1 }),
];

describe("withinDepth", () => {
  it("filters by absolute SERP position, not row count", () => {
    // Position 6 is missing (an ad took the slot), so "top 10" is 7 rows.
    expect(withinDepth(RUN66, 3).map(x => x.position)).toEqual([1, 2, 3]);
    expect(withinDepth(RUN66, 10).map(x => x.position)).toEqual([1, 2, 3, 4, 5, 7, 8]);
  });

  it("treats depth 0 as the whole SERP", () => {
    expect(withinDepth(RUN66, 0)).toHaveLength(RUN66.length);
  });

  it("returns results in SERP order", () => {
    const shuffled = [RUN66[4], RUN66[0], RUN66[2]];
    expect(withinDepth(shuffled, 0).map(x => x.position)).toEqual([1, 3, 5]);
  });
});

describe("cohortSizeFor", () => {
  it("uses two at a bounded depth and three across the whole SERP", () => {
    // Three of a top-3 would be the entire SERP, making "weakest" meaningless.
    expect(cohortSizeFor(3)).toBe(2);
    expect(cohortSizeFor(5)).toBe(2);
    expect(cohortSizeFor(10)).toBe(2);
    expect(cohortSizeFor(0)).toBe(3);
  });
});

describe("weakestCohort", () => {
  it("ranks by DR ascending, not by position", () => {
    expect(weakestCohort(withinDepth(RUN66, 5), R, 2).map(x => x.position)).toEqual([5, 2]);
  });

  it("excludes an authority domain whose PAGE is empty", () => {
    // liga.net (#1) has 0 backlinks but DR 77. A per-metric minimum would let
    // it define the easiest backlink target; ranking by DR must not.
    expect(weakestCohort(withinDepth(RUN66, 5), R, 2).some(x => x.position === 1)).toBe(false);
  });

  it("allows one page per domain", () => {
    // DR belongs to the site, so a domain holding two slots would otherwise
    // fill the cohort with itself and collapse it to a single competitor.
    const twinned = [
      u(1, 9, 90, "big.com"),
      u(2, 3, 10, "pbn.net"),
      u(3, 5, 10, "pbn.net"),
      u(4, 2, 40, "mid.org"),
    ];
    expect(weakestCohort(twinned, R, 2).map(x => x.position)).toEqual([2, 4]);
    expect(weakestCohort(twinned, R, 2)[0].position).toBe(2); // the weaker page
    expect(weakestCohort(twinned, R, 3).map(x => x.domain))
      .toEqual(["pbn.net", "mid.org", "big.com"]);
  });

  it("keeps hosts with no parseable domain distinct", () => {
    const hostless = [
      { ...u(1, 1, 5), domain: "", url: "a" },
      { ...u(2, 2, 6), domain: "", url: "b" },
    ];
    expect(weakestCohort(hostless, R, 2).map(x => x.position)).toEqual([1, 2]);
  });

  it("ignores unanalysed pages and pages missing the ranking metric", () => {
    const gaps = [
      u(1, 1, null, "a.com"),               // analysed, no DR
      u(2, 2, 5, "b.com", {}, false),        // DR present, never analysed
      u(3, 3, 40, "c.com"),
      u(4, 4, 30, "d.com"),
    ];
    expect(weakestCohort(gaps, R, 2).map(x => x.position)).toEqual([4, 3]);
  });

  it("degrades to whatever is eligible", () => {
    expect(weakestCohort([u(1, 1, 10), u(2, 2, 20, "x.com", {}, false)], R, 2)).toHaveLength(1);
    expect(weakestCohort([u(1, 1, 10, "a.com", {}, false)], R, 2)).toEqual([]);
    expect(weakestCohort(RUN66, null, 2)).toEqual([]);
  });

  it("breaks DR ties on UR then position, so the cohort is stable", () => {
    const ties = [u(1, 9, 72, "a.com"), u(2, 3, 72, "b.com"), u(3, 3, 72, "c.com"), u(4, 1, 80, "d.com")];
    expect(weakestCohort(ties, R, 2).map(x => x.position)).toEqual([2, 3]);
  });
});

describe("cohortAverage", () => {
  const cohort = weakestCohort(withinDepth(RUN66, 5), R, 2);

  it("averages the same pages across every metric", () => {
    expect(cohortAverage(cohort, "domain_rating")).toEqual({ value: 16, from: 2, of: 2 });
    expect(cohortAverage(cohort, "backlinks_dofollow")).toEqual({ value: 915, from: 2, of: 2 });
    expect(cohortAverage(cohort, "refdomains_dofollow")).toEqual({ value: 348, from: 2, of: 2 });
    expect(cohortAverage(cohort, "url_rating").value).toBeCloseTo(4.7, 5);
  });

  it("reports when an average rests on fewer pages than the cohort holds", () => {
    const partial = [u(1, 1, 10, "a.com", { backlinks: 50 }), u(2, 2, 20, "b.com")];
    expect(cohortAverage(partial, "backlinks")).toEqual({ value: 50, from: 1, of: 2 });
  });

  it("returns null rather than zero when nothing carries the metric", () => {
    expect(cohortAverage(cohort, "org_traffic")).toEqual({ value: null, from: 0, of: 2 });
  });
});

describe("bandOf", () => {
  it("separates an empty page on a strong domain from one on a weak domain", () => {
    // The distinction the whole ladder exists for.
    expect(bandOf({ url_rating: 0, domain_rating: 77 }, true, "url_rating")).toBe("propped");
    expect(bandOf({ url_rating: 4.6, domain_rating: 7 }, true, "url_rating")).toBe("soft");
  });

  it("bands by UR when UR drives", () => {
    expect(bandOf({ url_rating: 6, domain_rating: 76 }, true, "url_rating")).toBe("moderate");
    expect(bandOf({ url_rating: 22, domain_rating: 65 }, true, "url_rating")).toBe("strong");
  });

  it("bands by DR when DR drives", () => {
    expect(bandOf({ domain_rating: 12 }, true, "domain_rating")).toBe("soft");
    expect(bandOf({ domain_rating: 40 }, true, "domain_rating")).toBe("moderate");
    expect(bandOf({ domain_rating: 80 }, true, "domain_rating")).toBe("strong");
  });

  it("refuses to classify what it cannot measure", () => {
    expect(bandOf({ url_rating: 1 }, false, "url_rating")).toBe("unknown");
    expect(bandOf({ backlinks: 5 }, true, "backlinks")).toBe("unknown");
    expect(bandOf(undefined, true, "url_rating")).toBe("unknown");
  });
});

describe("bandCounts", () => {
  it("counts within whatever slice it is given", () => {
    expect(bandCounts(withinDepth(RUN66, 5), "url_rating").soft).toBe(2);
    expect(bandCounts(withinDepth(RUN66, 5), "url_rating").propped).toBe(1);
    expect(bandCounts([], "url_rating").soft).toBe(0);
    expect(bandCounts(RUN66, null).soft).toBe(0);
  });
});

describe("ladderDriver / weaknessRanker", () => {
  it("drives the ladder by page strength and ranks weakness by domain", () => {
    expect(ladderDriver(["domain_rating", "url_rating"])).toBe("url_rating");
    expect(weaknessRanker(["url_rating", "domain_rating"])).toBe("domain_rating");
  });

  it("falls back only when the job never requested the preferred metric", () => {
    expect(ladderDriver(["domain_rating", "backlinks"])).toBe("domain_rating");
    expect(weaknessRanker(["url_rating", "backlinks"])).toBe("url_rating");
    expect(ladderDriver(["backlinks"])).toBe("backlinks");
    expect(weaknessRanker([])).toBeNull();
  });
});

describe("barHeight", () => {
  it("keeps zero at zero and clamps the top", () => {
    expect(barHeight(0, "url_rating", 10)).toBe(0);
    expect(barHeight(null, "url_rating", 30)).toBe(0);
    expect(barHeight(999, "domain_rating", 100)).toBe(1);
  });

  it("scales DR linearly and UR against the run's own ceiling", () => {
    expect(barHeight(50, "domain_rating", 100)).toBe(0.5);
    expect(barHeight(4.8, "url_rating", 10)).toBeLessThan(barHeight(10, "url_rating", 10));
  });

  it("uses a log axis for heavy-tailed metrics", () => {
    const small = barHeight(10, "backlinks", 100000);
    const large = barHeight(100000, "backlinks", 100000);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeCloseTo(1, 5);
  });
});

describe("runCeiling", () => {
  it("finds the highest value anywhere in the run", () => {
    expect(runCeiling([{ urls: RUN66 }], "url_rating")).toBe(10);
    expect(runCeiling([{ urls: RUN66 }], null)).toBe(0);
    expect(runCeiling([], "url_rating")).toBe(0);
  });
});
