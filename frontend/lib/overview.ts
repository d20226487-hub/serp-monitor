// Shared aggregation + grouping logic for the run distribution overviews.
// Used by both the inline run-page overview (components/run-overview.tsx) and
// the dedicated full-breakdown page (app/runs/[id]/overview/page.tsx).

import { Result } from "@/lib/api";

export type DistRow = { key: string; count: number; avgPos: number };
export type SortKey = "count" | "avgPos";
export type SortDir = "asc" | "desc";

/** Count rows per domain or URL and average their SERP position. Rows with an
 * empty value for the field are skipped. */
export function aggregate(results: Result[], field: "domain" | "url"): DistRow[] {
  const map = new Map<string, { count: number; sumPos: number }>();
  for (const r of results) {
    const raw = field === "domain" ? r.domain : r.url;
    const key = (raw ?? "").trim();
    if (!key) continue;
    const cur = map.get(key) ?? { count: 0, sumPos: 0 };
    cur.count += 1;
    cur.sumPos += r.position;
    map.set(key, cur);
  }
  return Array.from(map.entries()).map(([key, v]) => ({
    key,
    count: v.count,
    avgPos: v.sumPos / v.count,
  }));
}

export function sortRows(rows: DistRow[], sortKey: SortKey, sortDir: SortDir): DistRow[] {
  const arr = [...rows];
  arr.sort((a, b) => {
    let cmp = sortKey === "count" ? a.count - b.count : a.avgPos - b.avgPos;
    if (cmp === 0) cmp = a.count - b.count; // tiebreak by frequency
    return sortDir === "asc" ? cmp : -cmp;
  });
  return arr;
}

// --- Multi-dimension grouping ------------------------------------------------

export type Dim = "engine" | "geo" | "language" | "device";

export const ALL_DIMS: Dim[] = ["engine", "geo", "language", "device"];

const MISSING = "—";

/** The value of one grouping dimension for a result row. GEO prefers the
 * city-level canonical_name, falling back to country code. */
export function dimValue(r: Result, dim: Dim): string {
  switch (dim) {
    case "engine":
      return r.engine || MISSING;
    case "geo":
      return r.location || r.country_code || MISSING;
    case "language":
      return r.language || MISSING;
    case "device":
      return r.device || MISSING;
  }
}

export type Group = {
  key: string;
  /** One value per selected dim, in the same order as the `dims` argument. */
  values: string[];
  rows: Result[];
};

/** Partition results into groups keyed by the cartesian combination of the
 * selected dimensions. Empty `dims` yields a single group over all results.
 * Groups are returned sorted by descending row count, then key. */
export function groupByDims(results: Result[], dims: Dim[]): Group[] {
  if (dims.length === 0) {
    return results.length ? [{ key: "__all__", values: [], rows: results }] : [];
  }
  const map = new Map<string, Group>();
  for (const r of results) {
    const values = dims.map((d) => dimValue(r, d));
    const key = values.join(" │ ");
    let g = map.get(key);
    if (!g) {
      g = { key, values, rows: [] };
      map.set(key, g);
    }
    g.rows.push(r);
  }
  return Array.from(map.values()).sort(
    (a, b) => b.rows.length - a.rows.length || a.key.localeCompare(b.key)
  );
}
