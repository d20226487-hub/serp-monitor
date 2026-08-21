import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORMULA,
  MIN_WEIGHT,
  SHORTLIST,
  aiFactor,
  barScore,
  combine,
  rankByScore,
  softScore,
  volumeScore,
  weightsFor,
} from "@/lib/opportunity";

const F = DEFAULT_FORMULA;
const CEIL = F.bar_dr_ceiling;

describe("volumeScore", () => {
  it("normalises against the run's largest", () => {
    expect(volumeScore(100, 100)).toBe(1);
    expect(volumeScore(25, 100)).toBe(0.5); // sqrt curve
    expect(volumeScore(500, 100)).toBe(1);  // clamped
  });

  it("keeps zero demand distinct from unknown demand", () => {
    // A keyword nobody searches scores 0; one whose volume was never entered
    // stays null and is left unranked rather than buried as worthless.
    expect(volumeScore(0, 100)).toBe(0);
    expect(volumeScore(null, 100)).toBeNull();
    expect(volumeScore(50, 0)).toBeNull();
  });

  it("compresses differently per curve", () => {
    expect(volumeScore(25, 100, "linear")).toBe(0.25);
    expect(volumeScore(25, 100, "sqrt")).toBe(0.5);
    expect(volumeScore(25, 100, "log")).toBeGreaterThan(0.5);
    // The ordering must hold across the WHOLE range, not just near the top:
    // linear harshest on small keywords, log the kindest, at every share.
    for (const v of [1, 5, 10, 25, 50]) {
      expect(volumeScore(v, 100, "linear")!).toBeLessThan(volumeScore(v, 100, "sqrt")!);
      expect(volumeScore(v, 100, "sqrt")!).toBeLessThan(volumeScore(v, 100, "log")!);
    }
    // All three agree at the extremes.
    expect(volumeScore(100, 100, "log")).toBeCloseTo(1, 10);
    expect(volumeScore(0, 100, "log")).toBe(0);
  });
});

describe("barScore", () => {
  it("maps entry-bar DR onto ease", () => {
    expect(barScore(0, CEIL)).toBe(1);
    expect(barScore(30, CEIL)).toBe(0.5);
    expect(barScore(CEIL, CEIL)).toBe(0);
    expect(barScore(77, CEIL)).toBe(0); // beyond the ceiling is still closed
    expect(barScore(-5, CEIL)).toBe(1); // clamped
  });

  it("treats an unmeasurable bar as closed, not open", () => {
    expect(barScore(null, CEIL)).toBe(0);
  });

  it("honours a configured ceiling", () => {
    expect(barScore(30, 30)).toBe(0);
    expect(barScore(30, 100)).toBeCloseTo(0.7, 5);
    expect(barScore(30, 0)).toBe(0); // guarded against divide-by-zero
  });
});

describe("softScore", () => {
  it("modulates between the floor and 1, never vetoing", () => {
    expect(softScore(0, 5, 0.5)).toBe(0.5);
    expect(softScore(2, 4, 0.5)).toBe(0.75);
    expect(softScore(5, 5, 0.5)).toBe(1);
    expect(softScore(0, 0, 0.5)).toBe(0.5);
  });

  it("can be disabled or made decisive by its floor", () => {
    expect(softScore(0, 5, 1)).toBe(1); // floor 1 = no effect
    expect(softScore(0, 5, 0)).toBe(0); // floor 0 = can veto
  });
});

describe("aiFactor", () => {
  it("maps each verdict through the formula", () => {
    expect(aiFactor("low", F)).toBe(1);
    expect(aiFactor("medium", F)).toBe(0.7);
    expect(aiFactor("hard", F)).toBe(0.35);
    expect(aiFactor("too hard", F)).toBe(0.1);
  });

  it("neither trusts nor writes off an unscored keyword", () => {
    expect(aiFactor(null, F)).toBe(0.5);
    expect(aiFactor("bananas", F)).toBe(0.5);
  });

  it("respects a configured override", () => {
    expect(aiFactor("too hard", { ...F, ai_too_hard: 0.9 })).toBe(0.9);
    expect(aiFactor("too hard", { ...F, ai_too_hard: 0 })).toBe(0);
  });
});

describe("weightsFor", () => {
  it("always sums to 2 so the score stays on one scale", () => {
    for (const b of [0, 0.25, 0.5, 0.75, 1]) {
      const { wv, ww } = weightsFor(b);
      expect(wv + ww).toBeCloseTo(2, 10);
    }
  });

  it("is balanced at the midpoint", () => {
    expect(weightsFor(0.5)).toEqual({ wv: 1, ww: 1 });
  });

  it("never lets either factor's exponent reach zero", () => {
    // Without this floor, dragging fully to "big prizes" drops winnability out
    // and the shortlist opens with the run's biggest unwinnable keyword.
    for (const b of [0, 1]) {
      const { wv, ww } = weightsFor(b);
      expect(wv).toBeGreaterThanOrEqual(MIN_WEIGHT);
      expect(ww).toBeGreaterThanOrEqual(MIN_WEIGHT);
    }
    expect(weightsFor(1, 0.4).ww).toBe(0.4);
  });
});

describe("combine", () => {
  it("is a geometric mean, so both halves must hold up", () => {
    expect(combine(0.25, 1, 0.5)).toBe(0.5);
    expect(combine(1, 0.25, 0.5)).toBe(0.5);
  });

  it("lets either factor veto at ANY slider position", () => {
    for (const b of [0, 0.25, 0.5, 0.75, 1]) {
      expect(combine(1, 0, b)).toBe(0);
      expect(combine(0, 1, b)).toBe(0);
    }
  });

  it("ranks a winnable small keyword above a hopeless large one", () => {
    const bigHopeless = combine(1.0, 0.02, 0.5);
    const smallEasy = combine(0.22, 0.8, 0.5);
    expect(smallEasy).toBeGreaterThan(bigHopeless);
  });

  it("shifts the ordering with the slider", () => {
    const bigHarder = [0.71, 0.4] as const;   // more volume, less winnable
    const smallEasier = [0.22, 0.8] as const;
    expect(combine(...bigHarder, 0.8)).toBeGreaterThan(combine(...smallEasier, 0.8));
    expect(combine(...bigHarder, 0.2)).toBeLessThan(combine(...smallEasier, 0.2));
  });
});

describe("rankByScore", () => {
  it("orders best first and leaves unknown demand unranked", () => {
    const ranked = rankByScore([
      { kw: "a", score: 10 },
      { kw: "b", score: null },
      { kw: "c", score: 50 },
    ]);
    expect(ranked.map(r => r.kw)).toEqual(["c", "a", "b"]);
    expect(ranked.map(r => r.rank)).toEqual([1, 2, null]);
  });
});

describe("DEFAULT_FORMULA", () => {
  it("matches the field set the server validates", () => {
    // Drifting from the server's DEFAULT_OPPORTUNITY_FORMULA would silently
    // drop a field from the editor or send one that gets discarded.
    expect(Object.keys(F).sort()).toEqual([
      "ai_hard", "ai_low", "ai_medium", "ai_too_hard", "ai_unknown",
      "balance", "bar_dr_ceiling", "min_weight", "shortlist", "soft_floor",
      "volume_curve",
    ]);
    expect(SHORTLIST).toBe(F.shortlist);
  });
});
