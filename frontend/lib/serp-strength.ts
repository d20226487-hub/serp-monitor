// How hard is each slot in a SERP to take?
//
// The analyzer view used to headline a MEDIAN per keyword, which describes no
// real page: on a SERP of liga.net (UR 0, DR 77), kzboostwin.net (UR 4.8,
// DR 25) and policecontrol.info (UR 10, DR 47) the median row is stitched from
// three different sites and hides the one fact that matters — position #1 is
// held by a page with no links of its own.
//
// What replaces it is an ENTRY BAR: within the depth you are aiming for, pick
// the COHORT_SIZE weakest pages by domain rating and average them. Every number
// in the row then comes from the same two real competitors — the ones you would
// actually have to displace — rather than from a synthetic midpoint.
//
// Two pages rather than one, because a single weakest page is a coin flip: one
// abandoned forum thread would set the whole bar. Ranked by DR rather than
// per-metric, because a per-metric minimum picks a different page in every
// column and lets an authority domain with an empty page profile (liga.net:
// UR 0, DR 77, zero backlinks) define the "easiest" backlink target, which it
// very much is not.

import { AnalysisUrl } from "@/lib/api";

/** Depth options for the "top N" control. 0 means the whole SERP. */
export const DEPTHS = [3, 5, 10, 0] as const;
export type Depth = (typeof DEPTHS)[number];

/**
 * How displaceable one result looks.
 *
 *  soft      weak page on a weak domain — the realistic target
 *  propped   page has no links of its own but sits on a strong domain: you can
 *            out-page it, the domain will still fight back on relevance
 *  moderate  a page with some link equity behind it
 *  strong    a genuinely well-linked page
 *  unknown   not analysed, or the driving metric is missing
 */
export type Band = "soft" | "propped" | "moderate" | "strong" | "unknown";

/**
 * Where the band boundaries sit, on each axis.
 *
 * Rules of thumb rather than Ahrefs constants, which is exactly why they are
 * configurable: UR is compressed near zero (a UR 15 page is already well
 * linked) while DR is not, so the two axes need separate cutoffs. The original
 * code used a single value of 20 for both and every result came out "weak",
 * because almost nothing scores UR 20.
 *
 * Defaults live on the server; these are the fallback before settings load.
 */
export type BandThresholds = {
  ur_soft: number;
  ur_strong: number;
  dr_soft: number;
  dr_strong: number;
};

export const DEFAULT_BANDS: BandThresholds = {
  ur_soft: 5, ur_strong: 15, dr_soft: 30, dr_strong: 70,
};

export const UR_SOFT = DEFAULT_BANDS.ur_soft;
export const UR_STRONG = DEFAULT_BANDS.ur_strong;
export const DR_SOFT = DEFAULT_BANDS.dr_soft;
export const DR_STRONG = DEFAULT_BANDS.dr_strong;

export function bandOf(
  m: Record<string, number | null> | undefined,
  analysed: boolean,
  driver: string,
  bands: BandThresholds = DEFAULT_BANDS,
): Band {
  if (!analysed || !m) return "unknown";
  const ur = m["url_rating"];
  const dr = m["domain_rating"];

  if (driver === "url_rating" && ur != null) {
    if (ur >= bands.ur_strong) return "strong";
    if (ur >= bands.ur_soft) return "moderate";
    // Below the soft cutoff the page itself is empty; the domain decides
    // whether that is an opportunity or a trap.
    return dr != null && dr >= bands.dr_soft ? "propped" : "soft";
  }
  if (driver === "domain_rating" && dr != null) {
    if (dr >= bands.dr_strong) return "strong";
    if (dr >= bands.dr_soft) return "moderate";
    return "soft";
  }
  // Any other driving metric has no absolute scale we can defend, so we do not
  // pretend to classify it — the bar height still carries the comparison.
  return "unknown";
}

/** Which metric drives bar height and banding: page strength first. */
export function ladderDriver(metrics: string[]): string | null {
  if (metrics.includes("url_rating")) return "url_rating";
  if (metrics.includes("domain_rating")) return "domain_rating";
  return metrics[0] ?? null;
}

/**
 * Bar height, 0..1.
 *
 * UR is square-rooted against the run's own ceiling (min 30) so the crowded
 * low end spreads out and a weak niche still reads as weak rather than being
 * rescaled to look normal. DR is already a 0-100 scale. Everything else is
 * heavy-tailed (backlinks, refdomains) and only makes sense on a log axis.
 */
export function barHeight(
  v: number | null | undefined,
  driver: string,
  runMax: number,
): number {
  if (v == null || v <= 0) return 0;
  if (driver === "domain_rating") return Math.min(1, v / 100);
  if (driver === "url_rating") {
    const ceil = Math.max(30, runMax);
    return Math.sqrt(Math.min(v, ceil) / ceil);
  }
  const top = Math.log10(1 + Math.max(runMax, 10));
  return Math.min(1, Math.log10(1 + v) / top);
}

/** Highest value of `driver` anywhere in the run — the ceiling bars scale to. */
export function runCeiling(rows: { urls: AnalysisUrl[] }[], driver: string | null): number {
  if (!driver) return 0;
  let max = 0;
  for (const r of rows) {
    for (const u of r.urls) {
      const v = u.metrics?.[driver];
      if (v != null && v > max) max = v;
    }
  }
  return max;
}

/** Results inside the chosen depth, in SERP order. Depth 0 = the whole SERP. */
export function withinDepth(urls: AnalysisUrl[], depth: Depth): AnalysisUrl[] {
  const inside = depth === 0 ? urls : urls.filter(u => u.position <= depth);
  return [...inside].sort((a, b) => a.position - b.position);
}

/**
 * At how many results the cohort grows from two competitors to three.
 *
 * Below this the SERP is too thin to spare a third: three of five results is
 * most of the page, and averaging most of a SERP is not an "entry bar", it is
 * just the SERP.
 */
export const COHORT_STEP_UP_AT = 7;

/**
 * How many of the weakest competitors the entry bar averages over.
 *
 * Scales with the number of results actually available, not with the depth
 * setting. Depth is what you are AIMING at; how many results came back is what
 * you have to work with, and those differ — a Top 10 view of a SERP that only
 * returned five results should behave like a small SERP, because it is one.
 *
 * More than one competitor because a single weakest page is a coin flip; no
 * more than three because past that the cohort stops describing the soft tail.
 */
export function cohortSizeFor(resultCount: number): number {
  return resultCount >= COHORT_STEP_UP_AT ? 3 : 2;
}

/**
 * Which metric decides who is weakest: domain rating.
 *
 * The fallbacks only fire when the job never requested DR, since a metric the
 * run did not pay for cannot rank anything.
 */
export function weaknessRanker(metrics: string[]): string | null {
  if (metrics.includes("domain_rating")) return "domain_rating";
  if (metrics.includes("url_rating")) return "url_rating";
  return metrics[0] ?? null;
}

/**
 * The `size` weakest DOMAINS inside the depth, weakest first.
 *
 * One page per domain. DR is a property of the domain, so a site holding two
 * slots would otherwise fill the cohort with itself twice and the "average of
 * the weakest competitors" would collapse to a single competitor. Where a
 * domain holds several slots we keep its weakest page, since that is the one
 * you would realistically displace.
 *
 * Only analysed pages are eligible. A page Ahrefs could not measure is not
 * "the weakest" — it is unknown, and letting it into the cohort as a zero
 * would invent an opening that may not exist.
 *
 * Ties break on UR then position, so the cohort is stable across renders.
 */
export function weakestCohort(
  urls: AnalysisUrl[],
  ranker: string | null,
  size: number,
): AnalysisUrl[] {
  if (!ranker) return [];
  const eligible = urls.filter(u => u.analysed && u.metrics?.[ranker] != null);
  eligible.sort((a, b) => {
    const cmp = (a.metrics[ranker] as number) - (b.metrics[ranker] as number);
    if (cmp !== 0) return cmp;
    const au = a.metrics["url_rating"] ?? Infinity;
    const bu = b.metrics["url_rating"] ?? Infinity;
    if (au !== bu) return au - bu;
    return a.position - b.position;
  });

  const out: AnalysisUrl[] = [];
  const claimed = new Set<string>();
  for (const u of eligible) {
    if (out.length >= size) break;
    // Fall back to the URL when the host could not be parsed, so an oddball
    // entry stays eligible instead of colliding with every other one under a
    // shared empty key.
    const key = u.domain || u.url;
    if (claimed.has(key)) continue;
    claimed.add(key);
    out.push(u);
  }
  return out;
}

export type CohortStat = {
  /** Mean across the cohort, or null when none of them carry this metric. */
  value: number | null;
  /** How many cohort members actually had a value — `of` is the cohort size.
   *  These differ when Ahrefs returned a partial record, and the UI says so
   *  rather than presenting a one-page average as a two-page one. */
  from: number;
  of: number;
};

/** Average one metric across the cohort, skipping members that lack it. */
export function cohortAverage(cohort: AnalysisUrl[], metric: string): CohortStat {
  const present: number[] = [];
  for (const u of cohort) {
    const v = u.metrics?.[metric];
    if (v != null) present.push(v);
  }
  return {
    value: present.length ? present.reduce((a, b) => a + b, 0) / present.length : null,
    from: present.length,
    of: cohort.length,
  };
}

/** Count of each band inside the depth — the shape of the SERP in one line. */
export function bandCounts(
  urls: AnalysisUrl[],
  driver: string | null,
  bands: BandThresholds = DEFAULT_BANDS,
): Record<Band, number> {
  const out: Record<Band, number> = {
    soft: 0, propped: 0, moderate: 0, strong: 0, unknown: 0,
  };
  if (!driver) return out;
  for (const u of urls) out[bandOf(u.metrics, u.analysed, driver, bands)] += 1;
  return out;
}
