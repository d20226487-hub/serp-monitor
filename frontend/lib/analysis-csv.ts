// CSV export for the analyzer overview table.
//
// Built in the browser from the rows already on screen rather than server-side,
// because the table is depth-dependent: the cohort, the averages and the soft
// counts all change with the Top 3/5/10/All control. A backend endpoint would
// have to reimplement lib/serp-strength in Python and could then disagree with
// what the user is looking at. Export-what-you-see keeps one source of truth.
//
// Headers are stable English snake_case regardless of UI language, matching the
// existing /runs/{id}/export.csv endpoint — a CSV is usually going somewhere
// that wants fixed column keys, not a translated report.

import { AnalysisUrl } from "@/lib/api";
import { Band, CohortStat, Depth } from "@/lib/serp-strength";

/** One exported row, already reduced to the numbers the table displays. */
export type AnalysisCsvRow = {
  keyword: string;
  volume: number | null;
  /** Which country the volume is priced in - always a country, never a city:
   *  keyword tools do not report city-level demand. */
  volumeCountry: string | null;
  /** 0-100 opportunity score, or null when no volume was entered. */
  score: number | null;
  rank: number | null;
  winnability: number;
  cohort: AnalysisUrl[];
  stats: Record<string, CohortStat>;
  bands: Record<Band, number>;
  analysed: number;
  total: number;
  difficulty: string | null;
  comment: string | null;
};

/** RFC 4180 quoting: wrap when the value could otherwise break the row, and
 *  double any embedded quote. AI comments carry commas, quotes and newlines. */
function cell(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Numbers for machines, not for reading: always a dot decimal separator and no
 * thousands grouping, whatever the viewer's locale. Averaging two pages can
 * produce 4.699999999999999, so trailing float noise is trimmed.
 */
function num(v: number | null | undefined): string {
  if (v == null) return "";
  return String(Number.isInteger(v) ? v : Number(v.toFixed(4)));
}

export function buildAnalysisCsv(
  rows: AnalysisCsvRow[],
  metrics: string[],
  depth: Depth,
  ranker: string,
): string {
  const header = [
    "keyword",
    // Leads with the decision columns: an export of this table is a shortlist,
    // so the score and its rank belong where the eye lands, not after twenty
    // diagnostic fields.
    "opportunity",
    "opportunity_rank",
    "volume",
    "volume_country",
    "winnability",
    "depth",
    "cohort_size",
    "ranked_by",
    "cohort_positions",
    "cohort_domains",
    ...metrics,
    // Named per metric so a partial average is auditable in the sheet rather
    // than only as an asterisk on screen.
    ...metrics.map(m => `${m}_pages_averaged`),
    "soft_slots",
    "domain_carried_slots",
    "moderate_slots",
    "strong_slots",
    "slots_analysed",
    "slots_total",
    "ai_difficulty",
    "ai_comment",
  ];

  const lines = [header.map(cell).join(",")];
  for (const r of rows) {
    lines.push([
      cell(r.keyword),
      num(r.score),
      cell(r.rank ?? ""),
      cell(r.volume ?? ""),
      cell(r.volumeCountry ?? ""),
      num(r.winnability),
      cell(depth === 0 ? "all" : `top${depth}`),
      // Per row, not per depth: a row's cohort is smaller when too few of its
      // pages came back analysed.
      cell(r.cohort.length),
      cell(ranker),
      cell(r.cohort.map(u => `#${u.position}`).join(" ")),
      cell(r.cohort.map(u => u.domain || u.url).join(" ")),
      ...metrics.map(m => num(r.stats[m]?.value)),
      ...metrics.map(m => cell(r.stats[m]?.from ?? 0)),
      cell(r.bands.soft),
      cell(r.bands.propped),
      cell(r.bands.moderate),
      cell(r.bands.strong),
      cell(r.analysed),
      cell(r.total),
      cell(r.difficulty ?? ""),
      cell(r.comment ?? ""),
    ].join(","));
  }
  return lines.join("\r\n");
}

export function analysisCsvFilename(runId: number, depth: Depth): string {
  return `run${runId}_analysis_${depth === 0 ? "all" : `top${depth}`}.csv`;
}

/** Hand the CSV to the browser as a download. */
export function downloadCsv(filename: string, csv: string): void {
  // Excel reads a UTF-8 CSV as the system codepage unless it finds a BOM, which
  // turns Russian keywords and AI comments into mojibake.
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
