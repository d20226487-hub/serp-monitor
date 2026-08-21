// Opportunity score: which keywords in this run are worth pursuing.
//
//     Opportunity = weighted geometric mean of VOLUME and WINNABILITY
//
// Geometric rather than arithmetic so both halves must hold up. A huge keyword
// you cannot win and a trivial keyword nobody searches should both rank low,
// and an average would give each of them a respectable middling score.
//
// Everything is normalised WITHIN the run. The question being answered is
// "which of these keywords first", not "is this keyword good in the abstract",
// and DR 30 means something different in casino affiliate SERPs than it does
// in B2B software.

import { AnalysisRow } from "@/lib/api";
import {
  Band,
  Depth,
  bandCounts,
  cohortAverage,
  cohortSizeFor,
  ladderDriver,
  weakestCohort,
  weaknessRanker,
  withinDepth,
} from "@/lib/serp-strength";

/**
 * Every constant in the score, as configuration.
 *
 * These are judgement calls dressed as arithmetic — how much a "too hard"
 * verdict should count differs between a brand-protection sweep and a content
 * -gap audit — so they are set globally in Settings and overridable per run,
 * not compiled in. The server owns the defaults and the bounds; this type just
 * has to match the JSON it sends.
 */
export type OpportunityFormula = {
  /** Slider default. 0 favours winnability, 1 favours volume. */
  balance: number;
  /** Exponent floor. Keeps either factor from dropping out entirely, so a
   *  hopeless keyword can never top the shortlist however the slider is set. */
  min_weight: number;
  /** Entry-bar DR at which a SERP counts as closed. 60 rather than 100 because
   *  the figure is the bar set by the WEAKEST competitors — if even they sit at
   *  DR 60, there is no soft underbelly left to aim at. */
  bar_dr_ceiling: number;
  /** Floor of the soft-slot modulator: it nudges, it never vetoes. */
  soft_floor: number;
  /** How raw volume is compressed before comparison. */
  volume_curve: "sqrt" | "linear" | "log";
  /**
   * What each AI verdict multiplies winnability by.
   *
   * A MULTIPLIER, not a term in a sum — the load-bearing choice in the whole
   * formula. On run 67 `melbet` has an entry bar of DR 0.0 and the judge still
   * called it medium, because it saw what the metrics cannot: the brand owns
   * the intent. Added into a weighted sum, a DR-0 bar would drown that verdict
   * out. Multiplied, the verdict can veto.
   */
  ai_low: number;
  ai_medium: number;
  ai_hard: number;
  ai_too_hard: number;
  /** Used when the AI never returned a verdict: neither trusted nor written off. */
  ai_unknown: number;
  /** How many top-ranked keywords are highlighted as the shortlist. */
  shortlist: number;
};

/** Mirrors the server's DEFAULT_OPPORTUNITY_FORMULA. Only a fallback for the
 *  moment before the first response arrives — the server is the authority. */
export const DEFAULT_FORMULA: OpportunityFormula = {
  balance: 0.5,
  min_weight: 0.2,
  bar_dr_ceiling: 60,
  soft_floor: 0.5,
  volume_curve: "sqrt",
  ai_low: 1.0,
  ai_medium: 0.7,
  ai_hard: 0.35,
  ai_too_hard: 0.1,
  ai_unknown: 0.5,
  shortlist: 5,
};

/** The multiplier for one AI verdict under a given formula. */
export function aiFactor(difficulty: string | null, f: OpportunityFormula): number {
  switch (difficulty) {
    case "low": return f.ai_low;
    case "medium": return f.ai_medium;
    case "hard": return f.ai_hard;
    case "too hard": return f.ai_too_hard;
    default: return f.ai_unknown;
  }
}

export type Balance = number; // 0 = pure winnability, 0.5 = equal, 1 = pure volume

export type OpportunityParts = {
  /** Demand, 0-1: this keyword's volume against the run's largest. */
  volume: number | null;
  /** Entry-bar ease, 0-1, from the weakest-domains cohort's DR. */
  bar: number;
  /** Soft-slot modulator, 0.5-1. Never zero: it nudges, it does not veto. */
  soft: number;
  /** The AI verdict's multiplier. */
  ai: number;
  /** bar x soft x ai. */
  winnability: number;
  /** Final 0-100 score, or null when the volume is unknown. */
  score: number | null;
  /** Raw volume, straight through for display. */
  rawVolume: number | null;
};

/**
 * Volume, normalised against the biggest in the run and square-rooted.
 *
 * The square root is the point: search volume spans orders of magnitude, and
 * left raw a single 60k keyword flattens every other score to noise. Rooting
 * turns a 100x volume gap into a 10x score gap — still decisive, no longer
 * the only thing that matters.
 */
export function volumeScore(
  volume: number | null,
  maxVolume: number,
  curve: OpportunityFormula["volume_curve"] = "sqrt",
): number | null {
  if (volume == null || maxVolume <= 0) return null;
  if (volume <= 0) return 0;
  const share = Math.min(1, volume / maxVolume);
  if (curve === "linear") return share;
  if (curve === "log") {
    // Flattest of the three: use when a handful of head terms would otherwise
    // decide the whole ranking on volume alone.
    //
    // The constant has to be this large to earn that description. With
    // log10(1 + 9x) the curve sits BELOW sqrt for any share under ~0.25 — so
    // the option billed as flattening hardest was in fact punishing small
    // keywords harder than the default, which is backwards. log10(1 + 99x)/2
    // is above sqrt across the whole range and still maps 0 to 0 and 1 to 1.
    return Math.log10(1 + 99 * share) / 2;
  }
  return Math.sqrt(share);
}

/** Entry-bar ease from the cohort's average DR: DR 0 -> 1, DR 60+ -> 0. */
export function barScore(cohortDr: number | null, ceiling: number): number {
  if (cohortDr == null || ceiling <= 0) return 0;
  return 1 - Math.min(Math.max(cohortDr, 0), ceiling) / ceiling;
}

/**
 * Soft slots as a 0.5-1 modulator rather than a 0-1 factor.
 *
 * A SERP with no soft slot is harder, not impossible — the entry bar and the
 * AI verdict are the signals entitled to veto. Bounding this at 0.5 keeps it
 * from silently doing so.
 */
export function softScore(soft: number, slots: number, floor: number): number {
  if (slots <= 0) return floor;
  return floor + (1 - floor) * (soft / slots);
}

/**
 * Neither factor's exponent ever reaches zero.
 *
 * Without this floor, dragging the slider fully to "big prizes" drops
 * winnability out of the formula entirely, and the run-67 shortlist opens with
 * `1xbet` at 100.0 — the highest volume in the run behind a DR-77 wall the
 * judge called "too hard". A tool that recommends an unwinnable keyword at any
 * setting is worse than one with a narrower slider, so 0.2 of the weight always
 * stays on the other side and a zero factor can still veto.
 */
export const MIN_WEIGHT = DEFAULT_FORMULA.min_weight;

/** Exponents for the two factors. Always sum to 2, so the score stays on the
 *  same 0-1 scale wherever the slider sits. */
export function weightsFor(balance: Balance, minWeight = MIN_WEIGHT): { wv: number; ww: number } {
  const span = 2 - 2 * minWeight;
  return {
    wv: minWeight + balance * span,
    ww: minWeight + (1 - balance) * span,
  };
}

/**
 * Weighted geometric mean of volume and winnability.
 *
 * `balance` runs 0 (favour quick wins) through 0.5 (equal) to 1 (favour big
 * prizes). Geometric rather than arithmetic so both halves must hold up: an
 * average would hand a hopeless 60k keyword a respectable middling score.
 */
export function combine(
  volume: number,
  winnability: number,
  balance: Balance,
  minWeight = MIN_WEIGHT,
): number {
  // Either factor at zero zeroes the result, whatever the weights. Guarded
  // explicitly because 0^0 is 1 in JS, which would turn a veto into a free pass.
  if (volume <= 0 || winnability <= 0) return 0;
  const { wv, ww } = weightsFor(balance, minWeight);
  return Math.pow(Math.pow(volume, wv) * Math.pow(winnability, ww), 0.5);
}

/** Score one keyword. `maxVolume` is the run's largest, for normalisation. */
export function scoreRow(
  row: AnalysisRow,
  depth: Depth,
  metrics: string[],
  maxVolume: number,
  balance: Balance,
  formula: OpportunityFormula = DEFAULT_FORMULA,
): OpportunityParts {
  const inDepth = withinDepth(row.urls, depth);

  // Two different metrics on purpose, and it matters which is which.
  //
  // The cohort is picked by WEAKNESS (domain rating) — the entry-bar rule the
  // table headline already uses. The bands are counted by the LADDER driver
  // (page strength), because that is what the "Soft slots" column on screen
  // counts. Using the ranker for both, as this first did, made the score's soft
  // factor disagree with the soft count sitting next to it in the same row:
  // two numbers with one name, quietly differing.
  const cohort = weakestCohort(inDepth, weaknessRanker(metrics), cohortSizeFor(depth));
  // Deliberately DR and not the ranking metric: the bar ceiling below is
  // calibrated on domain rating, so a run that ranked by UR would otherwise be
  // scored against a scale that does not apply to it.
  const cohortDr = cohortAverage(cohort, "domain_rating").value;
  const bands: Record<Band, number> = bandCounts(inDepth, ladderDriver(metrics));

  const bar = barScore(cohortDr, formula.bar_dr_ceiling);
  const soft = softScore(bands.soft, inDepth.length, formula.soft_floor);
  const ai = aiFactor(row.difficulty, formula);
  const winnability = bar * soft * ai;

  const volume = volumeScore(row.volume, maxVolume, formula.volume_curve);
  return {
    volume,
    bar,
    soft,
    ai,
    winnability,
    rawVolume: row.volume,
    score: volume == null
      ? null
      : combine(volume, winnability, balance, formula.min_weight) * 100,
  };
}

/** The largest volume present in the run — the normalisation denominator. */
export function maxVolumeOf(rows: AnalysisRow[]): number {
  let max = 0;
  for (const r of rows) if (r.volume != null && r.volume > max) max = r.volume;
  return max;
}

/**
 * Ranks by score, best first. Keywords with no volume sort last and keep a
 * null rank: unknown demand is not the same as no demand, and guessing here
 * would quietly promote or bury a keyword on a number nobody supplied.
 */
export function rankByScore<T extends { score: number | null }>(items: T[]): (T & { rank: number | null })[] {
  const scored = items.filter(i => i.score != null);
  const unscored = items.filter(i => i.score == null);
  scored.sort((a, b) => (b.score as number) - (a.score as number));
  return [
    ...scored.map((i, idx) => ({ ...i, rank: idx + 1 })),
    ...unscored.map(i => ({ ...i, rank: null })),
  ];
}

/** Fallback shortlist size. The live value comes from the formula. */
export const SHORTLIST = DEFAULT_FORMULA.shortlist;
