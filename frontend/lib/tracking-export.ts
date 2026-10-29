// Position Tracking's CSV export (user, 2026-10-29: "Export button. The user
// presses on it and export the whole table with ranking. Plus there is an
// arrow by pressing on which the user can customize the export … GEO =>
// search engine (multiple can be selected), then multi selects top N position
// values, and Изменения").
//
// The rows are already on the page, so the file is written here. It follows
// the app's other exports: a BOM so Excel reads UTF-8, ";" between columns and
// a decimal comma in Russian, "," and a point in English.

import type { TrackingRow, TrackingSerp } from "@/lib/api";
import { ChangeKind, Compare, NO_CLUSTER, bandStart, changeOf, spanOf, visible } from "@/lib/position-tracking";

export { bandStart };

/** A band of positions: a top N stands for the places after the top before
 *  it (the user's choice: "Топ 1 = #1, Топ 3 = #2–3 … Топ 100 = #51–100"), so
 *  several can be picked at once. "none": not on the latest page. */
export type Band = number | "none";

/** The band a latest position is in; null when it is deeper than the last top. */
export function bandOf(position: number | null, thresholds: number[]): Band | null {
  if (position === null) return "none";
  for (const n of thresholds) if (position <= n) return n;
  return null;
}

/** What to export. null = all of it. */
export type ExportChoice = {
  serps: string[] | null;
  bands: Band[] | null;
  changes: ChangeKind[] | null;
  /** Clusters (NO_CLUSTER: none) — user, 2026-10-29: "Add the cluster
   *  selection in the export as well". */
  clusters: string[] | null;
};

export const EVERYTHING: ExportChoice = { serps: null, bands: null, changes: null, clusters: null };

/** The rows a choice keeps: every row the table can show under the comparison
 *  in use — whatever the table's own filters are — narrowed by the choice. */
export function exportRows(
  rows: TrackingRow[], choice: ExportChoice, compare: Compare, thresholds: number[],
): TrackingRow[] {
  return rows.filter(r => {
    if (!visible(r, compare)) return false;
    if (choice.serps && !choice.serps.includes(r.serp)) return false;
    if (choice.bands) {
      const band = bandOf(r.position, thresholds);
      if (band === null || !choice.bands.includes(band)) return false;
    }
    if (choice.changes && !choice.changes.includes(changeOf(r, compare).kind)) return false;
    if (choice.clusters && !choice.clusters.includes(r.cluster ?? NO_CLUSTER)) return false;
    return true;
  });
}

/** The words the file is written with — the page's language. */
export type CsvWords = {
  head: string[];
  /** The cluster column's title — given only for a project with clusters:
   *  the column then follows the keyword. */
  clusterHead?: string;
  engine: (engine: string) => string;
  kind: (kind: ChangeKind) => string;
};

/**
 * The table as rows of text, a header first: the Position Tracking table's
 * own columns, and the domain (user, 2026-10-29: "The export should only that
 * is related to the Position Tracking feature. Domain should be left just in
 * case") — keyword, URL, domain, GEO, search engine, latest, best, average,
 * the change, where it was then (user, asked how to show that: "«Было»
 * column in the file") and what the change was.
 */
export function trackingTable(
  rows: TrackingRow[], lang: string, compare: Compare,
  serpOf: (row: TrackingRow) => TrackingSerp | undefined, words: CsvWords,
): string[][] {
  const num = (v: number | null) => (v === null ? "" : lang === "ru" ? String(v).replace(".", ",") : String(v));
  const body = rows.map(r => {
    const serp = serpOf(r);
    const change = changeOf(r, compare);
    // Best and average over the same span as the change, as in the table.
    const span = spanOf(r, compare);
    const point = compare === "check" ? r.previous_check : r.previous_period;
    return [
      r.keyword,
      ...(words.clusterHead !== undefined ? [r.cluster ?? ""] : []),
      r.url,
      r.domain,
      (serp?.country_code ?? "").toUpperCase(),
      serp ? words.engine(serp.engine) : "",
      num(r.position),
      num(span.best),
      num(span.average),
      change.delta === null ? "" : change.delta > 0 ? `+${change.delta}` : String(change.delta),
      // Where it was at the check compared with: "—" not on that page, ""
      // when the keyword had no such check.
      point ? (point.position === null ? "—" : num(point.position)) : "",
      words.kind(change.kind),
    ];
  });
  const head = words.clusterHead !== undefined
    ? [words.head[0], words.clusterHead, ...words.head.slice(1)]
    : words.head;
  return [head, ...body];
}

/** CSV text as Excel reads it in either language. */
export function toCsv(table: string[][], lang: string): string {
  const sep = lang === "ru" ? ";" : ",";
  const cell = (v: string) => (/[";,\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "﻿" + table.map(row => row.map(cell).join(sep)).join("\r\n") + "\r\n";
}
