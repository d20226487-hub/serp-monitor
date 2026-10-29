// Position Tracking: what the page works out from the rows the server sends —
// how a URL moved, which rows a filter keeps, the order they sort in, and how
// a SERP is named so two variants of one engine and country can be told apart.
// Kept apart from the component so the rules can be tested.

import type { KeywordBest, TrackingPoint, TrackingRow, TrackingSerp } from "@/lib/api";

/** What a change is measured against: the check before the latest one (the
 *  default — the user: "compared by default to the last upload"), or the
 *  latest check of the previous period. */
export type Compare = "check" | "period";

export type ChangeKind = "up" | "down" | "same" | "new" | "lost" | "none";

export type Change = {
  kind: ChangeKind;
  /** Places gained: positive moved up, negative moved down. Null unless the
   *  URL was on both pages. */
  delta: number | null;
  /** Where it was then, when it was there. */
  was: number | null;
};

export function changeOf(row: TrackingRow, compare: Compare): Change {
  const point = compare === "check" ? row.previous_check : row.previous_period;
  // The keyword had no such check: nothing to compare with.
  if (!point) return { kind: "none", delta: null, was: null };
  const was = point.position;
  const now = row.position;
  if (now === null && was === null) return { kind: "none", delta: null, was: null };
  if (now === null) return { kind: "lost", delta: null, was };
  if (was === null) return { kind: "new", delta: null, was: null };
  if (now === was) return { kind: "same", delta: 0, was };
  return { kind: now < was ? "up" : "down", delta: was - now, was };
}

/** What a row's best, average and trend cover. */
export type Span = {
  best: number | null;
  average: number | null;
  rankedIn: number;
  checks: number;
  readings: TrackingPoint[];
};

/**
 * Best, average and the trend over the same span as the change (user,
 * 2026-10-29: "make Лучшая and Средняя comparable to Изменение"): the
 * period's checks and, when the check compared with is from before the period,
 * that one too. The previous check is inside the period whenever the period
 * holds two or more checks of the keyword; the previous period's never is.
 * The average is taken from the sum, not from the rounded mean.
 */
export function spanOf(row: TrackingRow, compare: Compare): Span {
  const point = compare === "check" ? (row.checks === 1 ? row.previous_check : null) : row.previous_period;
  if (!point) {
    return { best: row.best, average: row.average, rankedIn: row.ranked_in, checks: row.checks, readings: row.readings };
  }
  const p = point.position;
  const rankedIn = row.ranked_in + (p === null ? 0 : 1);
  const sum = row.position_sum + (p ?? 0);
  return {
    best: p === null ? row.best : row.best === null ? p : Math.min(row.best, p),
    average: rankedIn ? Math.round((sum / rankedIn) * 10) / 10 : null,
    rankedIn,
    checks: row.checks + 1,
    readings: [point, ...row.readings],
  };
}

/** A row is shown when the URL ranked in the period, or was on the page it is
 *  compared with (then it dropped out since). A URL that only the OTHER
 *  comparison knows is not this comparison's business. */
export function visible(row: TrackingRow, compare: Compare): boolean {
  if (row.best !== null) return true;
  const point = compare === "check" ? row.previous_check : row.previous_period;
  return !!point && point.position !== null;
}

export type Filters = {
  engine: string;          // "all" or an engine
  geo: string;             // "all" or a country code, upper-case
  top: number | "all";     // the latest position within the top N
  change: ChangeKind | "all";
  compare: Compare;
  query: string;           // in the keyword or the URL
};

export const NO_FILTERS: Filters = { engine: "all", geo: "all", top: "all", change: "all", compare: "check", query: "" };

const CHANGE_KINDS: (ChangeKind | "all")[] = ["all", "up", "down", "same", "new", "lost", "none"];

/** A stored set of filters as this page writes it — anything else is not taken back. */
export function isFilters(v: unknown): v is Filters {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  return typeof f.engine === "string" && typeof f.geo === "string" && typeof f.query === "string"
    && (f.top === "all" || (typeof f.top === "number" && f.top > 0))
    && CHANGE_KINDS.includes(f.change as ChangeKind) && (f.compare === "check" || f.compare === "period");
}

export function keep(row: TrackingRow, serp: TrackingSerp | undefined, f: Filters): boolean {
  if (!visible(row, f.compare)) return false;
  if (f.engine !== "all" && serp?.engine !== f.engine) return false;
  if (f.geo !== "all" && (serp?.country_code ?? "").toUpperCase() !== f.geo) return false;
  if (f.top !== "all" && (row.position === null || row.position > f.top)) return false;
  if (f.change !== "all" && changeOf(row, f.compare).kind !== f.change) return false;
  const q = f.query.trim().toLowerCase();
  if (q && !row.keyword.toLowerCase().includes(q) && !row.url.toLowerCase().includes(q)) return false;
  return true;
}

export type SortColumn = "keyword" | "geo" | "engine" | "position" | "best" | "average" | "change";
export type Sort = { column: SortColumn; descending: boolean };

const SORT_COLUMNS: SortColumn[] = ["keyword", "geo", "engine", "position", "best", "average", "change"];

export function isSort(v: unknown): v is Sort {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return SORT_COLUMNS.includes(s.column as SortColumn) && typeof s.descending === "boolean";
}

/** A change as a number to sort by: places gained, a new URL above any gain,
 *  a lost one below any drop; no comparison sorts last either way. */
function changeValue(c: Change): number | null {
  switch (c.kind) {
    case "up": case "down": case "same": return c.delta;
    case "new": return 1_000;
    case "lost": return -1_000;
    default: return null;
  }
}

/** The rows in order. Empty values — no position, no comparison — always go
 *  last, whichever way the column is sorted; ties fall back to the keyword,
 *  so the order never shuffles between renders. */
export function sorted(
  rows: TrackingRow[], sort: Sort, compare: Compare, serpOf: (row: TrackingRow) => TrackingSerp | undefined,
): TrackingRow[] {
  const value = (r: TrackingRow): string | number | null => {
    switch (sort.column) {
      case "keyword": return r.keyword.toLowerCase();
      case "geo": return (serpOf(r)?.country_code ?? "").toUpperCase();
      case "engine": return serpOf(r)?.engine ?? "";
      case "position": return r.position;
      case "best": return spanOf(r, compare).best;
      case "average": return spanOf(r, compare).average;
      case "change": return changeValue(changeOf(r, compare));
    }
  };
  const dir = sort.descending ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = value(a), vb = value(b);
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    if (va !== null && vb !== null && va !== vb) return (va < vb ? -1 : 1) * dir;
    return a.keyword.localeCompare(b.keyword) || (a.position ?? 10_000) - (b.position ?? 10_000) || a.url.localeCompare(b.url);
  });
}

/** What tells a SERP apart from the others of the same engine and country —
 *  device, city, search domain, language — and nothing when it is the only
 *  one: "Google · KZ", or "Google · KZ · google.kz" beside "… · google.com". */
export function serpExtras(serp: TrackingSerp, all: TrackingSerp[]): string[] {
  const twins = all.filter(s => s.engine === serp.engine && s.country_code === serp.country_code);
  if (twins.length < 2) return [];
  const differs = (pick: (s: TrackingSerp) => string | null) => new Set(twins.map(pick)).size > 1;
  const extras: string[] = [];
  if (differs(s => s.device) && serp.device) extras.push(serp.device);
  // A location is "City,Region,Country": the city is what tells two apart.
  if (differs(s => s.location) && serp.location) extras.push(serp.location.split(",")[0]);
  if (differs(s => s.google_domain)) extras.push(serp.google_domain ?? "—");
  if (differs(s => s.language) && serp.language) extras.push(serp.language);
  return extras;
}

/** The first place of a top's band: with tops 1, 3, 5, 10 … Топ 3 is #2–3 and
 *  Топ 10 is #6–10 — the places after the top before it. */
export function bandStart(n: number, thresholds: number[]): number {
  const before = thresholds.filter(t => t < n);
  return before.length ? Math.max(...before) + 1 : 1;
}

/** One band's count from the server's cumulative "in the top N" counts: the
 *  band of Топ 3 is the top 3 less the top 1. */
export function bandCount(cumulative: Record<string, number>, n: number, thresholds: number[]): number {
  const before = thresholds.filter(t => t < n);
  const prev = before.length ? cumulative[String(Math.max(...before))] ?? 0 : 0;
  return (cumulative[String(n)] ?? 0) - prev;
}

/** A URL that left the SERP: where it was on the page compared with. */
export type Dropped = { keyword: string; url: string; was: number };

/**
 * What dropped out of the top N (user, 2026-10-29: "Кол Выпавших запросов for
 * top 3, top 5, and so on" — and, on a first version that also counted a URL
 * that merely fell lower: "I meant more the URL left the SERP"): every URL of
 * the project's that was in the top N at the check compared with and is not
 * on the latest page at all. A URL that only moved down is not here.
 *
 * By BAND, not "within the top N" (user: "Should we count here twice? I think
 * we should treat it the same as in export"): the top N's column holds the
 * places from `from` to `n` — Топ 3 is #2–3 — so a URL that left is counted
 * once, in the band where it was.
 *
 * `rows` are one SERP's; `keywords` say which of its keywords had a check to
 * compare with at all — null when none did: nothing can be said, which is not
 * zero. The table counts KEYWORDS (`droppedKeywords`): two URLs of one keyword
 * leaving from one band are one keyword dropped.
 */
export function dropped(
  rows: TrackingRow[], keywords: KeywordBest[], from: number, n: number, compare: Compare,
): Dropped[] | null {
  if (!keywords.some(k => (compare === "check" ? k.had_check : k.had_period))) return null;
  const out: Dropped[] = [];
  for (const r of rows) {
    const point = compare === "check" ? r.previous_check : r.previous_period;
    if (point && point.position !== null && point.position >= from && point.position <= n && r.position === null) {
      out.push({ keyword: r.keyword, url: r.url, was: point.position });
    }
  }
  return out.sort((a, b) => a.keyword.localeCompare(b.keyword) || a.was - b.was);
}

/** How many keywords those URLs belong to. */
export function droppedKeywords(found: Dropped[]): number {
  return new Set(found.map(d => d.keyword)).size;
}
