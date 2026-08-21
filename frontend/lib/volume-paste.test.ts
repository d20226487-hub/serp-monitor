import { describe, expect, it } from "vitest";
import { parseVolumeNumber, parseVolumePaste } from "@/lib/volume-paste";

const KW = ["melbet", "mostbet", "1xbet", "pin-up", "vavada"];

describe("parseVolumeNumber", () => {
  it("accepts the shapes Ahrefs emits", () => {
    expect(parseVolumeNumber("20000")).toBe(20000);
    expect(parseVolumeNumber("20,000")).toBe(20000);
    expect(parseVolumeNumber("20 000")).toBe(20000);
    expect(parseVolumeNumber("20 000")).toBe(20000); // non-breaking space
    expect(parseVolumeNumber('"20,000"')).toBe(20000);
    expect(parseVolumeNumber("0")).toBe(0);
  });

  it("reads K/M suffixes as decimal multipliers", () => {
    expect(parseVolumeNumber("1.2K")).toBe(1200);
    expect(parseVolumeNumber("1,2K")).toBe(1200); // comma decimal locale
    expect(parseVolumeNumber("2M")).toBe(2000000);
  });

  it("returns null for anything that is not a volume", () => {
    // Ahrefs writes "-" for unknown. Recording that as 0 would claim the
    // keyword has no demand, which is a different and false statement.
    expect(parseVolumeNumber("-")).toBeNull();
    expect(parseVolumeNumber("—")).toBeNull();
    expect(parseVolumeNumber("")).toBeNull();
    expect(parseVolumeNumber("N/A")).toBeNull();
  });
});

describe("parseVolumePaste", () => {
  // A real Keywords Explorer row: the volume is in the MIDDLE, CPC at the end.
  const AHREFS = [
    "Keyword\tCountry\tDifficulty\tVolume\tCPC\tParent Topic",
    "melbet\tkz\t34\t20,000\t0.45\tmelbet",
    "mostbet\tkz\t29\t30 000\t0.51\tmostbet",
    "1xbet\tkz\t71\t60,000\t1.20\t1xbet",
  ].join("\n");

  it("reads the Volume column, not the last number on the line", () => {
    // "The number at the end of the line" would take CPC as the volume.
    const r = parseVolumePaste(AHREFS, KW);
    expect(r.header).toEqual({ keyword: "Keyword", volume: "Volume", country: "Country" });
    expect(r.matched).toEqual([
      { keyword: "melbet", volume: 20000 },
      { keyword: "mostbet", volume: 30000 },
      { keyword: "1xbet", volume: 60000 },
    ]);
  });

  it("refuses to accept Global volume as Volume", () => {
    // They are different numbers; taking the global one inflates every score.
    const r = parseVolumePaste(
      "Keyword\tGlobal volume\tVolume\nmelbet\t900000\t20000", KW,
    );
    expect(r.matched).toEqual([{ keyword: "melbet", volume: 20000 }]);
  });

  it("reports the country so a wrong-market export is catchable", () => {
    expect(parseVolumePaste(AHREFS, KW).countries).toEqual(["kz"]);
    expect(parseVolumePaste("Keyword\tCountry\tVolume\nmelbet\tus\t50000", KW).countries)
      .toEqual(["us"]);
  });

  it("falls back to positional parsing without a header", () => {
    const r = parseVolumePaste("melbet\t20000\nmostbet\t30000", KW);
    expect(r.header).toBeNull();
    expect(r.matched).toEqual([
      { keyword: "melbet", volume: 20000 },
      { keyword: "mostbet", volume: 30000 },
    ]);
  });

  it("handles keywords containing spaces when headerless", () => {
    expect(parseVolumePaste("pin up casino  8000", ["pin up casino"]).matched)
      .toEqual([{ keyword: "pin up casino", volume: 8000 }]);
  });

  it("reports typos instead of writing them", () => {
    // A stray row would otherwise create a volume nothing ever reads, and the
    // score would never appear with no visible reason why.
    const r = parseVolumePaste("Keyword\tVolume\nmelbett\t20000\nmelbet\t500", KW);
    expect(r.unmatched).toEqual([{ keyword: "melbett", volume: 20000 }]);
    expect(r.matched).toEqual([{ keyword: "melbet", volume: 500 }]);
  });

  it("matches case-insensitively and stores the run's own spelling", () => {
    expect(parseVolumePaste("Keyword\tVolume\nMelBet\t777", KW).matched)
      .toEqual([{ keyword: "melbet", volume: 777 }]);
  });

  it("lets the last occurrence of a duplicate win", () => {
    expect(parseVolumePaste("Keyword\tVolume\nmelbet\t100\nmelbet\t999", KW).matched)
      .toEqual([{ keyword: "melbet", volume: 999 }]);
  });

  it("skips rows with no usable number rather than zeroing them", () => {
    const r = parseVolumePaste("Keyword\tVolume\nmelbet\t-\nmostbet\t30000", KW);
    expect(r.matched).toEqual([{ keyword: "mostbet", volume: 30000 }]);
    expect(r.skipped).toEqual(["melbet\t-"]);
  });

  it("lists run keywords the paste never mentioned", () => {
    expect(parseVolumePaste(AHREFS, KW).missing.sort()).toEqual(["pin-up", "vavada"]);
  });

  it("survives empty and junk input", () => {
    expect(parseVolumePaste("", KW).matched).toEqual([]);
    expect(parseVolumePaste("\n\n  \n", KW).matched).toEqual([]);
    expect(parseVolumePaste("no numbers here", KW).skipped).toEqual(["no numbers here"]);
  });
});
