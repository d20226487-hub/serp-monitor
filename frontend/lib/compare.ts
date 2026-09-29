// Comparison logic for compare-mode runs: the same queries sent to several
// providers, set side by side. Pure functions, no React — covered by
// compare.test.ts.
//
// Two rules keep the comparison honest, and most of this file is them:
//
// 1. Engines are compared separately. DataForSEO cannot run Yandex, so a
//    Yandex domain it "did not find" is a known gap, not a difference. Each
//    engine is compared only among the providers that can run it.
//
// 2. Totals are taken over the queries EVERY answering provider answered. A
//    provider whose request failed for one query would otherwise show every
//    domain of that SERP as missing from its column — a failure dressed up as
//    a disagreement. Failed queries still appear, in the counts table, where
//    they are reported as failures.

import { ProviderCost, Result, RunQuery } from "@/lib/api";
import { providerSupports } from "@/lib/providers";

/** The fields that identify one query. */
export type VariantFields = {
  engine: string;
  keyword: string;
  device: string;
  location: string | null;
  language: string | null;
  google_domain: string | null;
};

/** One query's identity as a string. Results and outcomes are both keyed
 *  through this, so they always join the same way. */
export function variantKey(v: VariantFields): string {
  return JSON.stringify([
    v.engine, v.keyword, v.device,
    v.location ?? null, v.language ?? null, v.google_domain ?? null,
  ]);
}

/** A host for comparison: lower case, without a leading www. Two providers
 *  reporting www.shazam.com and shazam.com found the same site. */
export function domainKey(domain: string | null | undefined, url?: string | null): string {
  let host = (domain ?? "").trim().toLowerCase();
  if (!host && url) {
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      host = "";
    }
  }
  return host.replace(/^www\./, "");
}

/** The host a result COUNTS as, and how it got there.
 *
 * Mirrors the backend rule in routers/project_positions.py exactly, so a job's
 * "Resolve AMP and CDN results to the site shown" means the same thing here as
 * in the positions view: with it on, the host the engine DISPLAYED counts —
 * but only when the engine reported one; otherwise the linked host stands.
 *
 * In a comparison this matters more than anywhere else. Providers disagree on
 * WHICH host they report: Bright Data's Google results carry only the
 * displayed address (its link is Google's goto redirect), while SerpAPI and
 * DataForSEO report the link itself. An AMP or CDN result would then read as
 * by.tribuna.com in one column and cloudfront.net in the next — two providers
 * that found the same result, shown as disagreeing.
 */
export type CountedHost = {
  /** The comparison host (see domainKey). */
  host: string;
  /** The raw linked host, normalised the same way. */
  linked: string;
  /** The displayed host replaced a different linked one. */
  substituted: boolean;
  /** The job asked for the displayed host and the engine reported none, so
   *  the linked host stands in. Kept visible rather than silent: a quiet
   *  fallback is a wrong answer that looks right. */
  unresolved: boolean;
};

export function countedHost(r: Result, preferShown: boolean): CountedHost {
  const linked = domainKey(r.domain, r.url);
  const shown = domainKey(r.shown_host);
  if (!preferShown) return { host: linked, linked, substituted: false, unresolved: false };
  const host = shown || linked;
  return {
    host,
    linked,
    substituted: !!shown && !!linked && shown !== linked,
    unresolved: !shown,
  };
}

/** A URL for comparison. The scheme, a leading www., a trailing slash and the
 *  fragment are ignored — providers disagree on those for the very same page,
 *  and flagging them would bury the real differences. The path's case and the
 *  query string are kept: those can name a different page. */
export function urlKey(url: string | null | undefined): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return host + u.pathname.replace(/\/+$/, "") + u.search;
  } catch {
    return raw
      .replace(/#.*$/, "")
      .replace(/^[a-z]+:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/+$/, "");
  }
}

export type OutcomeStatus = RunQuery["status"] | "missing";

/** What one provider did with one query. `missing` = no outcome recorded yet
 *  (the run is still going, or was cut short). */
export type Outcome = { status: OutcomeStatus; count: number; error: string | null };

const MISSING: Outcome = { status: "missing", count: 0, error: null };

/** variant key -> provider -> outcome. */
export function outcomeIndex(queries: RunQuery[]): Map<string, Map<string, Outcome>> {
  const idx = new Map<string, Map<string, Outcome>>();
  for (const q of queries) {
    const k = variantKey(q);
    let byProvider = idx.get(k);
    if (!byProvider) {
      byProvider = new Map();
      idx.set(k, byProvider);
    }
    byProvider.set(q.provider, { status: q.status, count: q.result_count, error: q.error });
  }
  return idx;
}

const ENGINE_ORDER = ["google", "yandex"];

function orderEngines(engines: Iterable<string>): string[] {
  const set = new Set(engines);
  return [
    ...ENGINE_ORDER.filter(e => set.has(e)),
    ...Array.from(set).filter(e => !ENGINE_ORDER.includes(e)).sort(),
  ];
}

/** One engine's comparison universe. */
export type EngineScope = {
  engine: string;
  /** Providers that can run this engine, in the run's order. */
  providers: string[];
  /** Of those, the ones that answered at least one of this engine's queries.
   *  A provider that answered none — every request failed — has nothing to
   *  compare, so it is shown but kept out of every "found by" count. */
  answering: string[];
  /** This engine's queries (variant keys), in a stable order. */
  variants: string[];
  /** The queries EVERY answering provider answered: the basis for totals. */
  common: Set<string>;
};

export function engineScopes(providers: string[], queries: RunQuery[]): EngineScope[] {
  const idx = outcomeIndex(queries);
  const byEngine = new Map<string, Set<string>>();
  for (const q of queries) {
    if (!byEngine.has(q.engine)) byEngine.set(q.engine, new Set());
    byEngine.get(q.engine)!.add(variantKey(q));
  }
  return orderEngines(byEngine.keys()).map(engine => {
    const variants = Array.from(byEngine.get(engine)!).sort();
    // Which providers can run the engine comes from the recorded outcomes —
    // the runner marks the ones it never sent — and only falls back to the
    // static map for a run with no outcome rows for a provider yet.
    const supported = providers.filter(p => {
      const statuses = variants.map(v => idx.get(v)?.get(p)?.status);
      if (statuses.some(s => s !== undefined)) return statuses.some(s => s !== "unsupported");
      return providerSupports(p, engine);
    });
    const answering = supported.filter(p =>
      variants.some(v => idx.get(v)?.get(p)?.status === "ok"),
    );
    const common = new Set(
      variants.filter(v =>
        answering.length > 0 && answering.every(p => idx.get(v)?.get(p)?.status === "ok"),
      ),
    );
    return { engine, providers: supported, answering, variants, common };
  });
}

/** Which provider produced a result row. Rows from before providers were
 *  recorded per result came from the run's single provider. */
function providerOf(r: Result, fallback: string | null | undefined): string | null {
  return r.provider ?? fallback ?? null;
}

export type CrossCell = { count: number; avgPos: number; bestPos: number };

export type CrossRow = {
  /** The matching key (see domainKey / urlKey). */
  key: string;
  /** What to show: the host, or the first URL seen for this key. */
  label: string;
  /** Link target, for URL rows. */
  href: string | null;
  /** Per answering provider; absent = that provider never returned it. */
  cells: Record<string, CrossCell>;
  /** How many answering providers returned it at least once. */
  foundBy: number;
  /** Result rows across all providers. */
  total: number;
  /** Domain rows only: linked hosts that were counted as this displayed host
   *  (AMP/CDN resolved). Empty when nothing was substituted. */
  substitutedFrom: string[];
};

/** Domains or URLs against providers, for one engine, over the common queries.
 *  A cell counts result rows (the same count the distribution tables use) and
 *  averages their positions.
 *
 *  `preferShown` applies the job's displayed-host rule to DOMAINS only. A URL
 *  cannot be resolved the same way — a CDN link's path says nothing about the
 *  publisher's page — so URLs are always compared as linked. */
export function crossTab(
  results: Result[],
  scope: EngineScope,
  field: "domain" | "url",
  runProvider?: string | null,
  preferShown = false,
): CrossRow[] {
  type Acc = { key: string; label: string; href: string | null; subs: Set<string>;
    cells: Record<string, { count: number; sumPos: number; bestPos: number }> };
  const rows = new Map<string, Acc>();
  const answering = new Set(scope.answering);
  for (const r of results) {
    if (r.engine !== scope.engine) continue;
    const p = providerOf(r, runProvider);
    if (!p || !answering.has(p)) continue;
    if (!scope.common.has(variantKey(r))) continue;
    const counted = field === "domain" ? countedHost(r, preferShown) : null;
    const key = counted ? counted.host : urlKey(r.url);
    if (!key) continue;
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        label: field === "domain" ? key : (r.url ?? key),
        href: field === "url" ? r.url : null,
        subs: new Set(),
        cells: {},
      };
      rows.set(key, row);
    }
    if (counted?.substituted) row.subs.add(counted.linked);
    const c = row.cells[p] ?? { count: 0, sumPos: 0, bestPos: Number.POSITIVE_INFINITY };
    c.count += 1;
    c.sumPos += r.position;
    c.bestPos = Math.min(c.bestPos, r.position);
    row.cells[p] = c;
  }
  return Array.from(rows.values()).map(row => {
    const cells: Record<string, CrossCell> = {};
    let total = 0;
    for (const [p, c] of Object.entries(row.cells)) {
      cells[p] = { count: c.count, avgPos: c.sumPos / c.count, bestPos: c.bestPos };
      total += c.count;
    }
    return { key: row.key, label: row.label, href: row.href, cells,
      foundBy: Object.keys(cells).length, total,
      substitutedFrom: Array.from(row.subs).sort() };
  });
}

/** Whether a cross-tab row is found by fewer than all answering providers. */
export function crossDiffers(row: CrossRow, scope: EngineScope): boolean {
  return row.foundBy < scope.answering.length;
}

export type CountRow = {
  key: string;
  variant: VariantFields & { country_code: string | null };
  cells: Record<string, Outcome>;
  /** A provider failed, or the answering providers returned different counts. */
  differs: boolean;
};

/** Results per SERP, per provider, for one engine — every query, including
 *  the failed ones this is the place to see. */
export function countRows(scope: EngineScope, queries: RunQuery[]): CountRow[] {
  const idx = outcomeIndex(queries);
  const fields = new Map<string, RunQuery>();
  for (const q of queries) {
    const k = variantKey(q);
    if (!fields.has(k)) fields.set(k, q);
  }
  return scope.variants.map(k => {
    const q = fields.get(k)!;
    const cells: Record<string, Outcome> = {};
    for (const p of scope.providers) cells[p] = idx.get(k)?.get(p) ?? MISSING;
    const answered = Object.values(cells).filter(c => c.status === "ok").map(c => c.count);
    const failed = Object.values(cells).some(c => c.status === "failed");
    return {
      key: k,
      variant: {
        engine: q.engine, keyword: q.keyword, device: q.device, location: q.location,
        language: q.language, google_domain: q.google_domain, country_code: q.country_code,
      },
      cells,
      differs: failed || new Set(answered).size > 1,
    };
  });
}

/** How a result in one provider's SERP relates to the other providers' SERPs
 *  for the same query:
 *    same — the URL is in every other answering provider's SERP;
 *    page — the site is everywhere, but not this page;
 *    site — the site itself is missing from some other provider's SERP;
 *    solo — no other provider answered, so there is nothing to compare. */
export type Mark = "same" | "page" | "site" | "solo";

export type SerpCell = { result: Result; mark: Mark; host: CountedHost };

export type SerpColumn = { provider: string; outcome: Outcome; rows: SerpCell[] };

export type VariantCompare = {
  key: string;
  variant: VariantFields & { country_code: string | null };
  columns: SerpColumn[];
  /** The longest SERP among the columns. */
  depth: number;
  /** Results marked page or site, across every column. */
  diffCount: number;
  differs: boolean;
};

/** Side-by-side SERPs for each of one engine's queries. `preferShown` applies
 *  the job's displayed-host rule to the site comparison (see countedHost);
 *  pages are always matched on the linked URL. */
export function compareVariants(
  results: Result[],
  queries: RunQuery[],
  scope: EngineScope,
  runProvider?: string | null,
  preferShown = false,
): VariantCompare[] {
  const idx = outcomeIndex(queries);
  const serps = new Map<string, Map<string, Result[]>>();
  for (const r of results) {
    if (r.engine !== scope.engine) continue;
    const p = providerOf(r, runProvider);
    if (!p) continue;
    const k = variantKey(r);
    if (!serps.has(k)) serps.set(k, new Map());
    const byP = serps.get(k)!;
    if (!byP.has(p)) byP.set(p, []);
    byP.get(p)!.push(r);
  }
  const counts = new Map(countRows(scope, queries).map(c => [c.key, c]));

  return scope.variants.map(k => {
    const byP = serps.get(k) ?? new Map<string, Result[]>();
    const outcomes = new Map(scope.providers.map(p => [p, idx.get(k)?.get(p) ?? MISSING]));
    const ok = scope.providers.filter(p => outcomes.get(p)!.status === "ok");
    const urls = new Map<string, Set<string>>();
    const hosts = new Map<string, Set<string>>();
    for (const p of ok) {
      const rows = byP.get(p) ?? [];
      urls.set(p, new Set(rows.map(r => urlKey(r.url)).filter(Boolean)));
      hosts.set(p, new Set(rows.map(r => countedHost(r, preferShown).host).filter(Boolean)));
    }
    let diffCount = 0;
    const columns: SerpColumn[] = scope.providers.map(p => {
      const rows = [...(byP.get(p) ?? [])].sort((a, b) => a.position - b.position);
      const others = ok.filter(o => o !== p);
      return {
        provider: p,
        outcome: outcomes.get(p)!,
        rows: rows.map(result => {
          const host = countedHost(result, preferShown);
          let mark: Mark;
          if (others.length === 0) {
            mark = "solo";
          } else {
            const u = urlKey(result.url);
            if (others.every(o => urls.get(o)!.has(u))) mark = "same";
            else if (others.every(o => hosts.get(o)!.has(host.host))) mark = "page";
            else mark = "site";
          }
          if (mark === "page" || mark === "site") diffCount += 1;
          return { result, mark, host };
        }),
      };
    });
    const count = counts.get(k)!;
    return {
      key: k,
      variant: count.variant,
      columns,
      depth: Math.max(0, ...columns.map(c => c.rows.length)),
      diffCount,
      differs: diffCount > 0 || count.differs,
    };
  });
}

export type KeywordCompare = {
  keyword: string;
  variants: VariantCompare[];
  /** Queries of this keyword with any difference. */
  differing: number;
};

export function byKeyword(variants: VariantCompare[]): KeywordCompare[] {
  const m = new Map<string, VariantCompare[]>();
  for (const v of variants) {
    if (!m.has(v.variant.keyword)) m.set(v.variant.keyword, []);
    m.get(v.variant.keyword)!.push(v);
  }
  return Array.from(m.entries()).map(([keyword, vs]) => ({
    keyword,
    variants: vs,
    differing: vs.filter(v => v.differs).length,
  }));
}

export type ProviderSummary = {
  provider: string;
  ok: number;
  failed: number;
  unsupported: number;
  /** No outcome yet — still running, or cut short. */
  pending: number;
  /** Result rows across the queries it answered. */
  results: number;
  /** Mean results per answered query. */
  avgResults: number | null;
  cost: ProviderCost | null;
};

export function providerSummaries(
  providers: string[],
  queries: RunQuery[],
  costs: Record<string, ProviderCost> | null | undefined,
): ProviderSummary[] {
  const variants = new Set(queries.map(q => variantKey(q)));
  return providers.map(p => {
    const mine = queries.filter(q => q.provider === p);
    const ok = mine.filter(q => q.status === "ok");
    const results = ok.reduce((n, q) => n + q.result_count, 0);
    return {
      provider: p,
      ok: ok.length,
      failed: mine.filter(q => q.status === "failed").length,
      unsupported: mine.filter(q => q.status === "unsupported").length,
      pending: Math.max(0, variants.size - mine.length),
      results,
      avgResults: ok.length ? results / ok.length : null,
      cost: costs?.[p] ?? null,
    };
  });
}
