"use client";
import { useMemo, useState } from "react";
import { AnalysisRow, RunAnalysis } from "@/lib/api";
import { useT } from "@/lib/i18n";

/**
 * Analyzer-mode view: one row per keyword with the MEDIAN Ahrefs metric across
 * every URL in that keyword's SERP, plus (phase 2) an AI difficulty verdict.
 *
 * Median rather than mean because a SERP routinely mixes one very strong result
 * with several ordinary ones; a mean would let that outlier dominate.
 *
 * Replaces the domain/URL distribution tables in analyzer mode — here the unit
 * of interest is the keyword, not the domain.
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

type SortKey = string; // "keyword" | "coverage" | a metric id

// Green through red — the verdict should be readable at a glance down a column.
const DIFFICULTY_STYLE: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
  hard: "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-200",
  "too hard": "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200",
};

function formatMetric(v: number | null | undefined): string {
  if (v == null) return "—";
  if (Number.isInteger(v)) return v.toLocaleString();
  // DR/UR come back fractional; one decimal is enough to compare SERPs.
  return v.toFixed(1);
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

export function RunAnalysisTable({ analysis }: { analysis: RunAnalysis }) {
  const { t } = useT();
  const [sortKey, setSortKey] = useState<SortKey>("keyword");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sorted = useMemo(() => {
    const arr = [...analysis.rows];
    arr.sort((a, b) => {
      let cmp: number;
      if (sortKey === "keyword") {
        cmp = a.keyword.localeCompare(b.keyword);
      } else if (sortKey === "coverage") {
        cmp = a.urls_analysed - b.urls_analysed;
      } else {
        // Nulls always sort last regardless of direction — an unmeasured
        // keyword isn't "the weakest", it's unknown.
        const av = a.medians[sortKey];
        const bv = b.medians[sortKey];
        if (av == null && bv == null) cmp = 0;
        else if (av == null) return 1;
        else if (bv == null) return -1;
        else cmp = av - bv;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [analysis.rows, sortKey, sortDir]);

  function toggle(key: SortKey) {
    if (key === sortKey) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      // Metrics read most usefully strongest-first; keyword alphabetically.
      setSortDir(key === "keyword" ? "asc" : "desc");
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
      <div className="px-4 py-2.5 bg-neutral-50 dark:bg-neutral-900/50 border-b dark:border-neutral-800 flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-sm">{t.analysis.title}</span>
        <span className="text-xs text-neutral-500">{t.analysis.subtitle}</span>
        {analysis.ahrefs_units != null && (
          <span className="ml-auto text-xs text-neutral-500">
            {t.analysis.units(analysis.ahrefs_units)}
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white dark:bg-neutral-900">
            <tr className="border-b dark:border-neutral-800 text-left">
              <th className={th} onClick={() => toggle("keyword")}>
                {t.analysis.colKeyword}{arrow("keyword")}
              </th>
              {analysis.metrics.map(m => (
                <th key={m} className={`${th} text-right`} onClick={() => toggle(m)}>
                  {METRIC_LABELS[m] ?? m}{arrow(m)}
                </th>
              ))}
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
            {sorted.map(row => (
              <AnalysisTableRow
                key={row.keyword}
                row={row}
                metrics={analysis.metrics}
                domainMetrics={analysis.domain_metrics}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 border-t dark:border-neutral-800 text-[11px] text-neutral-500">
        {t.analysis.footnote}
      </div>
    </div>
  );
}

function AnalysisTableRow({
  row, metrics, domainMetrics,
}: { row: AnalysisRow; metrics: string[]; domainMetrics: string[] }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const partial = row.urls_analysed < row.urls_total;
  // +4 = keyword, coverage, difficulty, comment around the metric columns.
  const span = metrics.length + 4;
  return (
    <>
      <tr className="border-b dark:border-neutral-800">
        <td className="px-3 py-2 font-medium break-all">
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
        {metrics.map(m => (
          <td
            key={m}
            className="px-3 py-2 text-right font-mono tabular-nums"
            title={t.analysis.cellHint(
              formatMetric(row.means[m]),
              formatMetric(row.mins[m]),
              formatMetric(row.maxes[m])
            )}
          >
            {formatMetric(row.medians[m])}
          </td>
        ))}
        <td
          className={`px-3 py-2 text-right font-mono tabular-nums ${
            partial ? "text-amber-700 dark:text-amber-300" : "text-neutral-500"
          }`}
          title={partial ? t.analysis.partialHint : undefined}
        >
          {row.urls_analysed}/{row.urls_total}
          {row.weak_slots != null && (
            <span
              className="ml-2 text-emerald-700 dark:text-emerald-300"
              title={t.analysis.weakHint(row.weak_field ?? "")}
            >
              {t.analysis.weakSlots(row.weak_slots)}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
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
        <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300 min-w-[16rem]">
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
                    <th className="px-2 py-1 font-medium">#</th>
                    <th className="px-2 py-1 font-medium">URL</th>
                    {metrics.map(m => (
                      <th key={m} className="px-2 py-1 font-medium text-right">
                        {METRIC_LABELS[m] ?? m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {row.urls.map((u, i) => (
                    <tr key={u.url} className="border-t dark:border-neutral-800">
                      <td className="px-2 py-1 text-neutral-400 font-mono">{i + 1}</td>
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
                  ))}
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
