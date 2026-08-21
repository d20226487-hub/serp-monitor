// CSV export for the analyzer overview table.
//
// Built in the browser from the rows already on screen rather than server-side,
// because the table is depth-dependent: the cohort, the averages and the soft
// counts all change with the Top 3/5/10/All control. A backend endpoint would
// have to reimplement lib/serp-strength in Python and could then disagree with
// what the user is looking at. Export-what-you-see keeps one source of truth.
//
// Headers are stable English regardless of UI language — a CSV is usually going
// somewhere that wants fixed column keys, not a translated report — but they are
// written the way a person reads them ("Referring domains (follow)"), not the way
// Ahrefs names its fields. The audience is someone opening the file in Excel.
//
// Which columns land in the file is the user's choice, so the export is defined
// here as an ordered list of column descriptors rather than as two parallel
// arrays of headers and values. Order lives with the definition and cannot be
// scrambled by a caller filtering the list.

import { AnalysisUrl } from "@/lib/api";
import { metricCsvHeader } from "@/lib/metric-labels";
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

/** Run-wide facts that are the same in every row: the depth the table was read
 *  at and the metric the cohort was picked by. */
export type AnalysisCsvContext = {
  depth: Depth;
  ranker: string;
};

/** How the picker groups the columns. Mirrors how the table reads left to
 *  right, so "the SERP shape column" is one box to untick rather than four
 *  scattered checkboxes. */
export type AnalysisCsvGroup = "keyword" | "score" | "shape" | "metrics" | "slots" | "ai";

export const CSV_GROUPS: AnalysisCsvGroup[] =
  ["keyword", "metrics", "slots", "ai", "score", "shape"];

export type AnalysisCsvColumn = {
  /** Stable id. Doubles as the persistence key, so it must not change even if
   *  the header text does — which is exactly what happened when the headers
   *  were rewritten for readability and every saved selection kept working. */
  id: string;
  /** The CSV header itself — English however the UI is set, and written for
   *  someone opening the file in Excel rather than for the API that produced
   *  it. */
  header: string;
  group: AnalysisCsvGroup;
  /** Set on the columns that report one Ahrefs metric, so the picker can label
   *  them the way the table's header does. */
  metric?: string;
  /** Whether the column is exported unless the user says otherwise. The
   *  defaults are the analyzer table's own columns: keyword, volume, the entry
   *  bar, soft slots, slot count, difficulty, score, comment. The SERP shape is
   *  out — a picture of a ladder has no useful CSV form — and so is everything
   *  that only exists to audit a number rather than to act on it. */
  byDefault: boolean;
  value: (row: AnalysisCsvRow, ctx: AnalysisCsvContext) => string;
};

/** Only the columns the user has explicitly toggled.
 *
 *  Stored as overrides rather than as the selected set, because the metric
 *  columns differ from run to run: a saved list of ticked ids would silently
 *  drop `backlinks_dofollow` from every future export the first time it is
 *  exported from a run that did not collect it. An untouched column follows
 *  `byDefault` forever. */
export type CsvColumnOverrides = Record<string, boolean>;

/** Prefixed so a metric can never collide with a fixed column id — Ahrefs is
 *  free to name a field `keyword`. */
export function metricColumnId(metric: string): string {
  return `metric:${metric}`;
}

export function pagesAveragedColumnId(metric: string): string {
  return `pages_averaged:${metric}`;
}

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

/**
 * The opportunity score at the same precision the table prints it, so a row
 * cannot read 12.8 on screen and 12.8127 in the sheet.
 *
 * Rounding creates ties the underlying score does not have, which is why the
 * file keeps the row order the table was in rather than leaving the reader to
 * re-sort by this column: 12.8127 and 12.8054 both print as 12.8, but the one
 * that was above stays above. `opportunity_rank` carries the same order as a
 * value for anyone who does re-sort.
 */
function score(v: number | null | undefined): string {
  return v == null ? "" : v.toFixed(1);
}

/**
 * Every column this table can export, in the order they are written.
 *
 * The order mirrors the analyzer table left to right — keyword, volume, the
 * entry-bar metrics, the slot counts, the AI verdict — because the export is
 * read next to the table it came from. The optional columns sit beside the
 * required one they qualify, so ticking `cohort_domains` puts it next to the
 * metrics it explains rather than at the end of the row.
 *
 * Order lives here and nowhere else: selecting columns removes them, it never
 * reshuffles what is left.
 */
export function analysisCsvColumns(metrics: string[]): AnalysisCsvColumn[] {
  return [
    {
      id: "keyword", header: "Keyword", group: "keyword", byDefault: true,
      value: r => cell(r.keyword),
    },
    {
      id: "volume", header: "Volume", group: "keyword", byDefault: true,
      value: r => cell(r.volume ?? ""),
    },
    // Which market the figure is priced in — the "(KZ)" in the table's own
    // Volume header. Off by default because a single-market export already
    // knows its own market; tick it when concatenating runs across countries.
    {
      id: "volume_country", header: "Volume country", group: "keyword", byDefault: false,
      value: r => cell(r.volumeCountry ?? ""),
    },
    // The entry bar itself: each one is the cohort AVERAGE, the number in the
    // table's UR/DR/Backlinks columns.
    ...metrics.map((m): AnalysisCsvColumn => ({
      id: metricColumnId(m), header: metricCsvHeader(m),
      group: "metrics", metric: m, byDefault: true,
      value: r => num(r.stats[m]?.value),
    })),
    // Not the metric — the COUNT of pages its average rested on. Ahrefs can
    // return a record with some fields empty, so an average may rest on fewer
    // pages than the cohort holds; this is the asterisk on screen, made
    // auditable in the sheet.
    ...metrics.map((m): AnalysisCsvColumn => ({
      id: pagesAveragedColumnId(m), header: `${metricCsvHeader(m)} pages averaged`,
      group: "metrics", metric: m, byDefault: false,
      value: r => cell(r.stats[m]?.from ?? 0),
    })),
    {
      id: "soft_slots", header: "weak pages", group: "slots", byDefault: true,
      value: r => cell(r.bands.soft),
    },
    {
      id: "domain_carried_slots", header: "domain-carried pages", group: "slots", byDefault: false,
      value: r => cell(r.bands.propped),
    },
    {
      id: "moderate_slots", header: "moderate pages", group: "slots", byDefault: false,
      value: r => cell(r.bands.moderate),
    },
    {
      id: "strong_slots", header: "strong pages", group: "slots", byDefault: false,
      value: r => cell(r.bands.strong),
    },
    {
      id: "slots_analysed", header: "pages_analysed", group: "slots", byDefault: false,
      value: r => cell(r.analysed),
    },
    {
      id: "slots_total", header: "pages_total", group: "slots", byDefault: true,
      value: r => cell(r.total),
    },
    {
      id: "ai_difficulty", header: "SERP difficulty", group: "ai", byDefault: true,
      value: r => cell(r.difficulty ?? ""),
    },
    {
      id: "opportunity", header: "Opportunity", group: "score", byDefault: true,
      value: r => score(r.score),
    },
    {
      id: "opportunity_rank", header: "Opportunity rank", group: "score", byDefault: false,
      value: r => cell(r.rank ?? ""),
    },
    {
      id: "winnability", header: "Winnability", group: "score", byDefault: false,
      value: r => num(r.winnability),
    },
    // The filename already records the depth, so the column is off unless the
    // sheet is going to be concatenated with exports at other depths.
    {
      id: "depth", header: "Depth", group: "shape", byDefault: false,
      value: (_r, ctx) => cell(ctx.depth === 0 ? "all" : `top${ctx.depth}`),
    },
    // Per row, not per depth: a row's cohort is smaller when too few of its
    // pages came back analysed.
    {
      id: "cohort_size", header: "Cohort size", group: "shape", byDefault: false,
      value: r => cell(r.cohort.length),
    },
    {
      id: "ranked_by", header: "Cohort ranked by", group: "shape", byDefault: false,
      value: (_r, ctx) => cell(ctx.ranker),
    },
    {
      id: "cohort_positions", header: "Cohort positions", group: "shape", byDefault: false,
      value: r => cell(r.cohort.map(u => `#${u.position}`).join(" ")),
    },
    {
      id: "cohort_domains", header: "Cohort domains", group: "shape", byDefault: false,
      value: r => cell(r.cohort.map(u => u.domain || u.url).join(" ")),
    },
    // Last on purpose: a paragraph of prose in the middle of a row makes every
    // column after it unreadable in a spreadsheet.
    {
      id: "ai_comment", header: "AI comment", group: "ai", byDefault: true,
      value: r => cell(r.comment ?? ""),
    },
  ];
}

/** Is this column exported, given what the user has toggled? */
export function isColumnOn(
  col: AnalysisCsvColumn, overrides: CsvColumnOverrides,
): boolean {
  return overrides[col.id] ?? col.byDefault;
}

/** The chosen columns, still in canonical order. */
export function selectedAnalysisCsvColumns(
  metrics: string[], overrides: CsvColumnOverrides,
): AnalysisCsvColumn[] {
  return analysisCsvColumns(metrics).filter(c => isColumnOn(c, overrides));
}

/** Drop overrides that only restate the default, so a selection reset back to
 *  the defaults is stored as nothing rather than as a frozen snapshot of
 *  today's column list. */
export function pruneOverrides(
  metrics: string[], overrides: CsvColumnOverrides,
): CsvColumnOverrides {
  const byDefault = new Map(analysisCsvColumns(metrics).map(c => [c.id, c.byDefault]));
  const out: CsvColumnOverrides = {};
  for (const [id, on] of Object.entries(overrides)) {
    // Anything not in this run's column list is a metric from another run —
    // keep it, or switching runs would quietly forget the choice.
    if (byDefault.get(id) !== on) out[id] = on;
  }
  return out;
}

export function buildAnalysisCsv(
  rows: AnalysisCsvRow[],
  columns: AnalysisCsvColumn[],
  ctx: AnalysisCsvContext,
): string {
  const lines = [columns.map(c => cell(c.header)).join(",")];
  for (const r of rows) {
    lines.push(columns.map(c => c.value(r, ctx)).join(","));
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
