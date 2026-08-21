// Parsing keyword volumes pasted out of Ahrefs.
//
// Two shapes turn up, and they need different handling:
//
//   1. A whole table copied from Keywords Explorer or a CSV export, header row
//      included. The volume is a column in the MIDDLE of the row —
//      "Keyword, Country, Difficulty, Volume, CPC, ..." — so any rule based on
//      "the number at the end of the line" reads CPC as the volume.
//   2. Two columns pulled out of a spreadsheet, no header.
//
// So: if a header row is present, trust it and index by column name. Only when
// there is none do we fall back to the positional guess.

export type ParsedVolume = {
  keyword: string;
  volume: number;
};

export type VolumeParseResult = {
  /** Parsed and matched to a keyword in the run. Ready to save. */
  matched: ParsedVolume[];
  /** Parsed, but no keyword in this run goes by that name — a typo or a stray
   *  row. Reported rather than written, so a mistake cannot quietly create a
   *  volume row that nothing ever reads. */
  unmatched: ParsedVolume[];
  /** Lines carrying no usable number. Ahrefs writes "-" for an unknown volume,
   *  and those land here rather than being recorded as zero. */
  skipped: string[];
  /** Keywords in the run the paste did not mention. */
  missing: string[];
  /** Column names, when a header row was recognised. Shown back to the user so
   *  a mis-detected column is visible before anything is saved. */
  header: { keyword: string; volume: string; country: string | null } | null;
  /** Country values seen in the paste, lowercased. Lets the UI catch a US
   *  export being pasted into a KZ run — the exact mistake the country-level
   *  nature of volume data invites. */
  countries: string[];
};

/** Ahrefs names this column "Volume"; some exports say "Search volume". The
 *  global figure is deliberately NOT accepted — it is a different number, and
 *  silently taking it would inflate every score. */
const VOLUME_HEADERS = ["volume", "search volume"];
const KEYWORD_HEADERS = ["keyword", "keywords"];
const COUNTRY_HEADERS = ["country", "location"];

const splitCells = (line: string): string[] =>
  line.includes("\t") ? line.split("\t") : line.split(/\s*[;,]\s*/);

const norm = (s: string) => s.trim().toLowerCase().replace(/^"|"$/g, "");

/**
 * "20 000" / "20,000" / "1.2K" -> 20000 / 20000 / 1200.
 *
 * Thousands separators are stripped rather than interpreted: which of "." and
 * "," means what depends on the exporter's locale, and guessing wrong is
 * silently off by a factor of 1000. Whole search volumes have no real decimal
 * part — the only exception is a K/M suffix, handled explicitly.
 */
export function parseVolumeNumber(raw: string): number | null {
  let s = (raw || "").trim().replace(/^"|"$/g, "").replace(/[\s ]/g, "");
  if (!s || s === "-" || s === "—") return null;

  let mult = 1;
  const suffix = s.slice(-1).toLowerCase();
  if (suffix === "k" || suffix === "m") {
    mult = suffix === "k" ? 1_000 : 1_000_000;
    s = s.slice(0, -1);
  }

  let cleaned: string;
  if (mult > 1) {
    // With a K/M suffix the separator IS a decimal point: "1.2K" is 1200.
    cleaned = s.replace(/,/g, ".");
    if (cleaned.split(".").length > 2) return null;
  } else {
    cleaned = s.replace(/[.,]/g, "");
  }
  if (!/^\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * mult);
}

/** Locate the keyword/volume/country columns in a candidate header row. */
function detectHeader(line: string) {
  const cells = splitCells(line).map(norm);
  const keyword = cells.findIndex(c => KEYWORD_HEADERS.includes(c));
  const volume = cells.findIndex(c => VOLUME_HEADERS.includes(c));
  if (keyword < 0 || volume < 0) return null;
  const country = cells.findIndex(c => COUNTRY_HEADERS.includes(c));
  return {
    keywordIdx: keyword,
    volumeIdx: volume,
    countryIdx: country < 0 ? null : country,
    names: {
      keyword: splitCells(line)[keyword].trim(),
      volume: splitCells(line)[volume].trim(),
      country: country < 0 ? null : splitCells(line)[country].trim(),
    },
  };
}

// Fallback for headerless pastes: keyword, separator, numeric tail. The keyword
// group is lazy so a keyword containing spaces still yields the longest number.
const POSITIONAL = /^(.+?)[\s,;\t]+([\d][\d\s., ]*[kKmM]?)$/;

export function parseVolumePaste(text: string, runKeywords: string[]): VolumeParseResult {
  const byLower = new Map(runKeywords.map(k => [k.trim().toLowerCase(), k]));
  const matched: ParsedVolume[] = [];
  const unmatched: ParsedVolume[] = [];
  const skipped: string[] = [];
  const countries = new Set<string>();
  const seen = new Set<string>();

  const lines = (text || "").split(/\r?\n/).filter(l => l.trim());
  let header: ReturnType<typeof detectHeader> = null;
  let start = 0;
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    const h = detectHeader(lines[i]);
    if (h) {
      header = h;
      start = i + 1;
      break;
    }
  }

  const add = (keyword: string, volume: number) => {
    const key = keyword.toLowerCase();
    const bucket = byLower.has(key) ? matched : unmatched;
    if (seen.has(key)) {
      // Last occurrence wins, which is how a spreadsheet edit reads.
      const idx = bucket.findIndex(p => p.keyword.toLowerCase() === key);
      if (idx >= 0) bucket[idx] = { keyword: bucket[idx].keyword, volume };
      return;
    }
    seen.add(key);
    // Store under the run's own spelling so the saved row joins back to it.
    bucket.push({ keyword: byLower.get(key) ?? keyword, volume });
  };

  for (const line of lines.slice(start)) {
    if (header) {
      const cells = splitCells(line);
      const keyword = (cells[header.keywordIdx] ?? "").trim().replace(/^"|"$/g, "");
      const volume = parseVolumeNumber(cells[header.volumeIdx] ?? "");
      if (header.countryIdx != null) {
        const cc = norm(cells[header.countryIdx] ?? "");
        if (cc) countries.add(cc);
      }
      if (!keyword || volume == null) {
        skipped.push(line);
        continue;
      }
      add(keyword, volume);
      continue;
    }
    const m = POSITIONAL.exec(line.trim());
    const volume = m ? parseVolumeNumber(m[2]) : null;
    const keyword = m ? m[1].trim() : "";
    if (!m || volume == null || !keyword) {
      skipped.push(line.trim());
      continue;
    }
    add(keyword, volume);
  }

  const touched = new Set(matched.map(p => p.keyword.toLowerCase()));
  return {
    matched,
    unmatched,
    skipped,
    missing: runKeywords.filter(k => !touched.has(k.trim().toLowerCase())),
    header: header ? header.names : null,
    countries: [...countries],
  };
}
