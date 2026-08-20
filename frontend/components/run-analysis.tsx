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
  ahrefs_rank: "Ahrefs Rank",
};

type SortKey = string; // "keyword" | "coverage" | a metric id

function formatMetric(v: number | null | undefined): string {
  if (v == null) return "—";
  if (Number.isInteger(v)) return v.toLocaleString();
  // DR/UR come back fractional; one decimal is enough to compare SERPs.
  return v.toFixed(1);
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
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <AnalysisTableRow key={row.keyword} row={row} metrics={analysis.metrics} />
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

function AnalysisTableRow({ row, metrics }: { row: AnalysisRow; metrics: string[] }) {
  const { t } = useT();
  const partial = row.urls_analysed < row.urls_total;
  return (
    <tr className="border-b last:border-b-0 dark:border-neutral-800">
      <td className="px-3 py-2 font-medium break-all">{row.keyword}</td>
      {metrics.map(m => (
        <td key={m} className="px-3 py-2 text-right font-mono tabular-nums">
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
      </td>
      <td className="px-3 py-2 text-right">
        {row.difficulty ? (
          <span className="text-xs font-medium">{row.difficulty}</span>
        ) : (
          <span className="text-xs text-neutral-400">{t.analysis.difficultyPending}</span>
        )}
      </td>
    </tr>
  );
}
