"use client";
import { useEffect, useMemo, useState } from "react";
import { AnalysisRow, AnalysisUrl, RunAnalysis } from "@/lib/api";
import { useT } from "@/lib/i18n";
import {
  Band,
  CohortStat,
  DEPTHS,
  Depth,
  bandCounts,
  bandOf,
  barHeight,
  cohortAverage,
  cohortSizeFor,
  ladderDriver,
  runCeiling,
  weakestCohort,
  weaknessRanker,
  withinDepth,
} from "@/lib/serp-strength";
import {
  analysisCsvFilename,
  buildAnalysisCsv,
  downloadCsv,
} from "@/lib/analysis-csv";

/**
 * Analyzer-mode view: one row per keyword showing the ENTRY BAR for the depth
 * you are aiming at — the two weakest pages by DR inside the top N, averaged.
 *
 * This replaced a median per keyword. A median describes no real page: it mixes
 * the strongest result's DR with the weakest result's UR and reports the blend
 * as if it were a competitor. Here every column describes the SAME two pages,
 * so the row is a profile of the competitors you would actually displace.
 *
 * Alongside it, a per-position ladder gives the SHAPE of the SERP at a glance —
 * bar height is page strength, colour is how displaceable that slot looks — so
 * "soft at #2 and #5" reads without opening anything. The cohort the numbers
 * come from is marked underneath it.
 */

const METRIC_LABELS: Record<string, string> = {
  url_rating: "UR",
  domain_rating: "DR",
  backlinks: "Backlinks",
  backlinks_dofollow: "Backlinks (follow)",
  refdomains: "Ref domains",
  refdomains_dofollow: "Ref domains (follow)",
  org_traffic: "Org. traffic",
  org_keywords: "Org. keywords",
  org_keywords_1_3: "Org. kw 1-3",
  org_keywords_4_10: "Org. kw 4-10",
  org_keywords_11_20: "Org. kw 11-20",
  refdomains_nofollow: "Ref domains (nofollow)",
  refips_subnets: "Ref IP subnets",
  ahrefs_rank: "Ahrefs Rank",
};

type SortKey = string; // "keyword" | "coverage" | "soft" | a metric id

// Green through red — the verdict should be readable at a glance down a column.
const DIFFICULTY_STYLE: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
  hard: "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-200",
  "too hard": "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200",
};

// One ramp, easiest to hardest. `propped` sits mid-ramp on purpose: the page is
// takeable but the domain behind it is not.
const BAND_BAR: Record<Band, string> = {
  soft: "bg-emerald-500",
  propped: "bg-amber-400",
  moderate: "bg-orange-500",
  strong: "bg-red-500",
  unknown: "bg-neutral-300 dark:bg-neutral-600",
};

const DEPTH_KEY = "analysisDepth";

function formatMetric(v: number | null | undefined): string {
  if (v == null) return "—";
  if (Number.isInteger(v)) return v.toLocaleString();
  // DR/UR come back fractional, and averaging two pages can land off a whole
  // number for any metric. One decimal is enough to compare SERPs; grouping
  // still applies, so a half-count of backlinks reads as 11,224.5 rather than
  // 11224.5.
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** "#1" / "#1, #4" — a list of SERP slots. Capped so a long list cannot
 *  push its column wide. */
function positionsLabel(positions: number[]): string {
  if (!positions.length) return "";
  const shown = positions.slice(0, 3).map(p => `#${p}`).join(", ");
  return positions.length > 3 ? `${shown} +${positions.length - 3}` : shown;
}

/**
 * The SERP as a row of bars, one per slot.
 *
 * Slots are laid out by absolute position, so a gap — an ad or an AI block
 * holding that place — stays visible as an empty slot rather than being closed
 * up. Closing it would silently renumber every result below it.
 */
function Ladder({
  urls, depth, driver, ceiling, cohort,
}: {
  urls: AnalysisUrl[];
  depth: Depth;
  driver: string | null;
  ceiling: number;
  cohort: AnalysisUrl[];
}) {
  const { t } = useT();
  const inDepth = withinDepth(urls, depth);
  const lastSlot = depth === 0
    ? urls.reduce((m, u) => Math.max(m, u.position), 0)
    : depth;
  if (!driver || lastSlot === 0) return <span className="text-neutral-400">—</span>;

  const byPos = new Map(inDepth.map(u => [u.position, u]));
  const slots = Array.from({ length: lastSlot }, (_, i) => i + 1);
  // Which slots the row's numbers were averaged from, so the table and the
  // picture cannot drift apart.
  const picked = new Set(cohort.map(u => u.position));

  return (
    <div className="flex items-end gap-[3px]">
      {slots.map(pos => {
        const u = byPos.get(pos);
        // Each slot is a fixed column: bar on top, cohort marker underneath.
        // The marker goes below rather than around the bar because at 7px wide
        // and 3px apart an outline would bleed into the neighbouring slot.
        const marker = (
          <span
            className={`mt-[3px] w-[3px] h-[3px] rounded-full ${
              picked.has(pos) ? "bg-neutral-500 dark:bg-neutral-300" : "bg-transparent"
            }`}
          />
        );
        if (!u) {
          // Nothing organic in this slot.
          return (
            <span
              key={pos}
              title={t.analysis.gapHint(pos)}
              className="flex flex-col items-center justify-end w-[7px] h-[30px]"
            >
              <span className="w-full h-px bg-neutral-300 dark:bg-neutral-700" />
              {marker}
            </span>
          );
        }
        const band = bandOf(u.metrics, u.analysed, driver);
        const h = barHeight(u.metrics?.[driver], driver, ceiling);
        const label = [
          `#${pos}`,
          hostOf(u.url),
          `${METRIC_LABELS[driver] ?? driver} ${formatMetric(u.metrics?.[driver])}`,
          t.analysis.bandHints[band] ?? "",
          picked.has(pos) ? t.analysis.inCohort : "",
        ].filter(Boolean).join(" · ");
        return (
          <span
            key={pos}
            title={label}
            className="flex flex-col items-center justify-end w-[7px] h-[30px]"
          >
            <span
              // A floor of 3px keeps a UR-0 page visible as an occupied slot —
              // it ranks, it just has nothing behind it.
              style={{ height: `${Math.max(3, Math.round(h * 24))}px` }}
              className={`w-full rounded-sm ${BAND_BAR[band]}`}
            />
            {marker}
          </span>
        );
      })}
    </div>
  );
}

function DomainSubTable({ row, metrics }: { row: AnalysisRow; metrics: string[] }) {
  const { t } = useT();
  if (!metrics.length || !row.domains?.length) return null;
  return (
    <div className="mt-3">
      <div className="text-[11px] text-neutral-500 mb-1">{t.analysis.rawDomainTitle}</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="px-2 py-1 font-medium">{t.analysis.colDomain}</th>
            {metrics.map(m => (
              <th key={m} className="px-2 py-1 font-medium text-right">
                {METRIC_LABELS[m] ?? m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row.domains.map(d => (
            <tr key={d.domain} className="border-t dark:border-neutral-800">
              <td className="px-2 py-1 font-mono break-all">{d.domain}</td>
              {metrics.map(m => (
                <td key={m} className="px-2 py-1 text-right font-mono tabular-nums">
                  {formatMetric(d.metrics[m])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One keyword reduced to the numbers the table shows at the current depth. */
type KeywordView = {
  row: AnalysisRow;
  /** The weakest pages by DR inside the depth — every metric cell averages
   *  THESE pages, so the whole row describes one pair of competitors. */
  cohort: AnalysisUrl[];
  stats: Record<string, CohortStat>;
  bands: Record<Band, number>;
  analysed: number;
  total: number;
};

export function RunAnalysisTable({
  analysis, runId,
}: { analysis: RunAnalysis; runId: number }) {
  const { t } = useT();
  const [sortKey, setSortKey] = useState<SortKey>("keyword");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [depth, setDepth] = useState<Depth>(5);

  // Depth is a working preference, not run state — read it back after mount so
  // the server-rendered markup stays deterministic.
  useEffect(() => {
    try {
      // Guard the absent key explicitly: Number(null) is 0, which is a VALID
      // depth here (0 = whole SERP), so a bare Number() would quietly override
      // the top-5 default for every first-time visitor.
      const saved = localStorage.getItem(DEPTH_KEY);
      if (saved === null) return;
      const n = Number(saved);
      if ((DEPTHS as readonly number[]).includes(n)) setDepth(n as Depth);
    } catch {}
  }, []);

  function pickDepth(d: Depth) {
    setDepth(d);
    try {
      localStorage.setItem(DEPTH_KEY, String(d));
    } catch {}
  }

  const driver = useMemo(() => ladderDriver(analysis.metrics), [analysis.metrics]);
  const ranker = useMemo(() => weaknessRanker(analysis.metrics), [analysis.metrics]);
  const rankerLabel = ranker ? METRIC_LABELS[ranker] ?? ranker : "";
  const ceiling = useMemo(
    () => runCeiling(analysis.rows, driver),
    [analysis.rows, driver],
  );

  const views: KeywordView[] = useMemo(
    () =>
      analysis.rows.map(row => {
        const inDepth = withinDepth(row.urls, depth);
        const cohort = weakestCohort(inDepth, ranker, cohortSizeFor(depth));
        const stats: Record<string, CohortStat> = {};
        for (const m of analysis.metrics) stats[m] = cohortAverage(cohort, m);
        return {
          row,
          cohort,
          stats,
          bands: bandCounts(inDepth, driver),
          analysed: inDepth.filter(u => u.analysed).length,
          total: inDepth.length,
        };
      }),
    [analysis.rows, analysis.metrics, depth, driver, ranker],
  );

  const sorted = useMemo(() => {
    const arr = [...views];
    arr.sort((a, b) => {
      let cmp: number;
      if (sortKey === "keyword") {
        cmp = a.row.keyword.localeCompare(b.row.keyword);
      } else if (sortKey === "coverage") {
        cmp = a.analysed - b.analysed;
      } else if (sortKey === "soft") {
        cmp = a.bands.soft - b.bands.soft;
      } else {
        // Nulls always sort last regardless of direction — an unmeasured
        // keyword isn't "the weakest", it's unknown.
        const av = a.stats[sortKey]?.value;
        const bv = b.stats[sortKey]?.value;
        if (av == null && bv == null) cmp = 0;
        else if (av == null) return 1;
        else if (bv == null) return -1;
        else cmp = av - bv;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [views, sortKey, sortDir]);

  // Exports exactly what is on screen: current depth, current sort order.
  function exportCsv() {
    const csv = buildAnalysisCsv(
      sorted.map(v => ({
        keyword: v.row.keyword,
        cohort: v.cohort,
        stats: v.stats,
        bands: v.bands,
        analysed: v.analysed,
        total: v.total,
        difficulty: v.row.difficulty,
        comment: v.row.comment,
      })),
      analysis.metrics,
      depth,
      ranker ?? "",
    );
    downloadCsv(analysisCsvFilename(runId, depth), csv);
  }

  function toggle(key: SortKey) {
    if (key === sortKey) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      // The entry bar reads most usefully lowest-first — the easiest way in.
      // Soft slots are the opposite: the keywords worth attacking are the ones
      // with the MOST displaceable positions, so lead with those.
      setSortDir(key === "soft" ? "desc" : "asc");
    }
  }

  const arrow = (key: SortKey) =>
    key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const th =
    "px-3 py-2 font-medium text-neutral-500 cursor-pointer select-none hover:text-neutral-900 dark:hover:text-neutral-100";

  if (analysis.rows.length === 0) {
    return (
      <div className="border rounded-md p-6 dark:border-neutral-700 text-sm text-neutral-500">
        {t.analysis.empty}
      </div>
    );
  }

  return (
    <div className="border rounded-md dark:border-neutral-700 overflow-hidden">
      <div className="px-4 py-2.5 bg-neutral-50 dark:bg-neutral-900/50 border-b dark:border-neutral-800 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-medium text-sm">{t.analysis.title}</span>
        <span className="text-xs text-neutral-500">
          {t.analysis.subtitle(depth, cohortSizeFor(depth), rankerLabel)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            title={t.analysis.exportHint}
            className="px-2 py-0.5 text-xs rounded-md border dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {t.analysis.exportCsv}
          </button>
          <span className="text-xs text-neutral-500">{t.analysis.depthLabel}</span>
          <div className="inline-flex rounded-md border dark:border-neutral-700 overflow-hidden">
            {DEPTHS.map(d => (
              <button
                key={d}
                type="button"
                onClick={() => pickDepth(d)}
                aria-pressed={depth === d}
                className={`px-2 py-0.5 text-xs border-l first:border-l-0 dark:border-neutral-700 ${
                  depth === d
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`}
              >
                {d === 0 ? t.analysis.depthAll : t.analysis.depthOption(d)}
              </button>
            ))}
          </div>
          {analysis.ahrefs_units != null && (
            <span className="text-xs text-neutral-500 pl-1">
              {t.analysis.units(analysis.ahrefs_units)}
            </span>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white dark:bg-neutral-900">
            <tr className="border-b dark:border-neutral-800 text-left">
              <th className={th} onClick={() => toggle("keyword")}>
                {t.analysis.colKeyword}{arrow("keyword")}
              </th>
              {/* The ladder is a picture; there is nothing to order it by that
                  the Soft slots column does not already carry. */}
              <th className="px-3 py-2 font-medium text-neutral-500">
                {t.analysis.colShape}
              </th>
              {analysis.metrics.map(m => (
                <th key={m} className={`${th} text-right`} onClick={() => toggle(m)}>
                  {METRIC_LABELS[m] ?? m}{arrow(m)}
                </th>
              ))}
              <th className={`${th} text-right`} onClick={() => toggle("soft")}>
                {t.analysis.colSoft}{arrow("soft")}
              </th>
              <th className={`${th} text-right`} onClick={() => toggle("coverage")}>
                {t.analysis.colCoverage}{arrow("coverage")}
              </th>
              <th className="px-3 py-2 font-medium text-neutral-500 text-right">
                {t.analysis.colDifficulty}
              </th>
              <th className="px-3 py-2 font-medium text-neutral-500">
                {t.analysis.colComment}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(view => (
              <AnalysisTableRow
                key={view.row.keyword}
                view={view}
                metrics={analysis.metrics}
                domainMetrics={analysis.domain_metrics}
                depth={depth}
                driver={driver}
                ceiling={ceiling}
                rankerLabel={rankerLabel}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 border-t dark:border-neutral-800 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
        <span>{t.analysis.legendTitle}</span>
        {(["soft", "propped", "moderate", "strong", "unknown"] as Band[]).map(b => (
          <span key={b} className="inline-flex items-center gap-1" title={t.analysis.bandHints[b]}>
            <span className={`inline-block w-2 h-2 rounded-sm ${BAND_BAR[b]}`} />
            {t.analysis.bandLabels[b]}
          </span>
        ))}
      </div>
      <div className="px-4 py-2 border-t dark:border-neutral-800 text-[11px] text-neutral-500">
        {t.analysis.footnote}
      </div>
    </div>
  );
}

function AnalysisTableRow({
  view, metrics, domainMetrics, depth, driver, ceiling, rankerLabel,
}: {
  view: KeywordView;
  metrics: string[];
  domainMetrics: string[];
  depth: Depth;
  driver: string | null;
  ceiling: number;
  rankerLabel: string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const { row, cohort, stats, bands, analysed, total } = view;
  const partial = analysed < total;
  const cohortPositions = positionsLabel(cohort.map(u => u.position).sort((a, b) => a - b));
  // Only the bands actually present, so the tooltip stays short on a SERP that
  // is all one colour.
  const bandBreakdown = (["soft", "propped", "moderate", "strong", "unknown"] as Band[])
    .filter(b => bands[b] > 0)
    .map(b => t.analysis.bandCount(b, bands[b]))
    .join(", ");
  // +6 = keyword, shape, soft, coverage, difficulty, comment around the metrics.
  const span = metrics.length + 6;
  return (
    <>
      <tr className="border-b dark:border-neutral-800">
        <td className="px-3 py-2 font-medium break-all align-top">
          {/* Toggles the raw per-URL rows — the manual check on what Ahrefs
              actually returned for this keyword's SERP. */}
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="inline-flex items-center gap-1.5 text-left hover:underline"
            aria-expanded={open}
          >
            <span className={`text-neutral-400 transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
            {row.keyword}
          </button>
        </td>
        <td className="px-3 py-2 align-top">
          <Ladder
            urls={row.urls}
            depth={depth}
            driver={driver}
            ceiling={ceiling}
            cohort={cohort}
          />
          {/* Naming the slots once, here, beats repeating them under every
              column — the cohort is the same for the whole row now. */}
          {cohort.length > 0 && (
            <div
              className="text-[10px] text-neutral-400 font-mono mt-1"
              title={t.analysis.cohortHint(cohort.length, rankerLabel)}
            >
              {t.analysis.cohortLabel(cohortPositions)}
            </div>
          )}
        </td>
        {metrics.map(m => {
          const stat = stats[m];
          // Ahrefs can return a record with some fields empty, so an average
          // may rest on fewer pages than the cohort holds. Say so rather than
          // passing a one-page figure off as a two-page one.
          const shortfall = stat != null && stat.value != null && stat.from < stat.of;
          return (
            <td
              key={m}
              className="px-3 py-2 text-right align-top"
              title={
                stat?.value != null
                  ? t.analysis.cellHint(
                      METRIC_LABELS[m] ?? m,
                      stat.from,
                      stat.of,
                      rankerLabel,
                      cohortPositions,
                    )
                  : undefined
              }
            >
              <div className="font-mono tabular-nums">
                {formatMetric(stat?.value)}
                {shortfall && <span className="text-amber-600 dark:text-amber-400">*</span>}
              </div>
            </td>
          );
        })}
        {/* Soft slots and coverage are separate questions — how winnable this
            SERP looks, versus how much of it we could measure at all — so they
            get separate columns rather than sharing one cell. */}
        <td
          className="px-3 py-2 text-right font-mono tabular-nums align-top"
          title={
            total === 0
              ? t.analysis.noneInDepth
              : t.analysis.softHint(bands.soft, total, bandBreakdown)
          }
        >
          {total === 0 ? (
            <span className="text-neutral-400">—</span>
          ) : bands.soft > 0 ? (
            <span className="text-emerald-700 dark:text-emerald-300">{bands.soft}</span>
          ) : (
            <span className="text-neutral-400">0</span>
          )}
        </td>
        <td
          className={`px-3 py-2 text-right font-mono tabular-nums align-top ${
            partial ? "text-amber-700 dark:text-amber-300" : "text-neutral-500"
          }`}
          title={
            total === 0
              ? t.analysis.noneInDepth
              : partial
                ? t.analysis.partialHint
                : t.analysis.coverageHint(analysed, total)
          }
        >
          {total === 0 ? (
            <span className="text-neutral-400">—</span>
          ) : (
            `${analysed}/${total}`
          )}
        </td>
        <td className="px-3 py-2 text-right whitespace-nowrap align-top">
          {row.difficulty ? (
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${DIFFICULTY_STYLE[row.difficulty] ?? ""}`}>
              {t.analysis.difficultyLabels[row.difficulty] ?? row.difficulty}
            </span>
          ) : row.ai_error ? (
            <span className="text-xs text-red-600 dark:text-red-400" title={row.ai_error}>
              {t.analysis.aiFailed}
            </span>
          ) : (
            <span className="text-xs text-neutral-400">{t.analysis.difficultyPending}</span>
          )}
        </td>
        <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300 min-w-[16rem] align-top">
          {row.comment || <span className="text-neutral-400">—</span>}
        </td>
      </tr>
      {open && (
        <tr className="border-b dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40">
          <td colSpan={span} className="px-3 py-2">
            <div className="text-[11px] text-neutral-500 mb-1">{t.analysis.rawTitle}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-neutral-500">
                    <th className="px-2 py-1 font-medium">{t.analysis.colPos}</th>
                    <th className="px-2 py-1 font-medium">URL</th>
                    {metrics.map(m => (
                      <th key={m} className="px-2 py-1 font-medium text-right">
                        {METRIC_LABELS[m] ?? m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {row.urls.map(u => {
                    const band: Band = driver ? bandOf(u.metrics, u.analysed, driver) : "unknown";
                    // Everything below the selected depth is context, not a
                    // competitor for the slot you are aiming at.
                    const inDepth = depth === 0 || u.position <= depth;
                    const picked = cohort.some(c => c.position === u.position);
                    return (
                      <tr
                        key={`${u.position}-${u.url}`}
                        className={`border-t dark:border-neutral-800 ${inDepth ? "" : "opacity-50"} ${
                          picked ? "bg-neutral-100/70 dark:bg-neutral-800/50" : ""
                        }`}
                      >
                        <td className="px-2 py-1 font-mono whitespace-nowrap">
                          <span
                            className={`inline-block w-1.5 h-1.5 rounded-sm mr-1.5 align-middle ${BAND_BAR[band]}`}
                            title={t.analysis.bandHints[band]}
                          />
                          {u.position}
                          {/* The rows the headline numbers were averaged from. */}
                          {picked && (
                            <span
                              className="ml-1.5 text-[9px] uppercase tracking-wide text-neutral-500"
                              title={t.analysis.cohortHint(cohort.length, rankerLabel)}
                            >
                              {t.analysis.inCohort}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <a
                            href={u.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-700 dark:text-blue-300 hover:underline break-all font-mono"
                          >
                            {u.url}
                          </a>
                          {/* Never hide that we measured a different URL than the
                              one that ranked. */}
                          {u.normalized && (
                            <div className="text-neutral-500 break-all">
                              {t.analysis.analyzedAs}{" "}
                              <span className="font-mono">{u.analyzed_url}</span>
                            </div>
                          )}
                          {u.positions.length > 1 && (
                            <span className="ml-2 text-neutral-500">
                              {t.analysis.alsoAt(
                                positionsLabel(u.positions.filter(p => p !== u.position)),
                              )}
                            </span>
                          )}
                          {!u.analysed && (
                            <span className="ml-2 text-amber-700 dark:text-amber-300">
                              {t.analysis.notAnalysed}
                            </span>
                          )}
                          {u.error && (
                            <span className="ml-2 text-red-600 dark:text-red-400">
                              {t.analysis.fetchFailed}
                            </span>
                          )}
                        </td>
                        {metrics.map(m => (
                          <td key={m} className="px-2 py-1 text-right font-mono tabular-nums">
                            {formatMetric(u.metrics[m])}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <DomainSubTable row={row} metrics={domainMetrics} />
          </td>
        </tr>
      )}
    </>
  );
}
