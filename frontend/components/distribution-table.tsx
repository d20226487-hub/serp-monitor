"use client";
import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { DistRow, SortKey, SortDir, sortRows } from "@/lib/overview";

/**
 * A single sortable frequency table (domains or URLs). Sort state is internal;
 * click the Count / Avg. position headers to sort. Count defaults high→low,
 * average position defaults best (low)→worst.
 */
export function DistributionTable({
  title,
  keyHeader,
  rows,
  isUrl,
}: {
  title: string;
  keyHeader: string;
  rows: DistRow[];
  isUrl: boolean;
}) {
  const { t } = useT();
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => sortRows(rows, sortKey, sortDir), [rows, sortKey, sortDir]);

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "avgPos" ? "asc" : "desc");
    }
  }

  const arrow = (key: SortKey) =>
    key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const thBtn =
    "cursor-pointer select-none hover:text-slate-900 dark:hover:text-slate-100";

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
      <div className="px-3 py-2 bg-slate-50 dark:bg-slate-900/50 border-b dark:border-slate-800 flex items-baseline gap-2">
        <span className="font-medium text-sm">{title}</span>
        <span className="text-xs text-slate-600 dark:text-slate-400">({rows.length})</span>
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white dark:bg-slate-900 z-10">
            <tr className="border-b dark:border-slate-800 text-left">
              <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-400">{keyHeader}</th>
              <th
                className={`px-3 py-2 font-medium text-slate-600 dark:text-slate-400 w-20 text-right ${thBtn}`}
                onClick={() => toggle("count")}
                title={t.run.overview.colCount}
              >
                {t.run.overview.colCount}
                {arrow("count")}
              </th>
              <th
                className={`px-3 py-2 font-medium text-slate-600 dark:text-slate-400 w-24 text-right ${thBtn}`}
                onClick={() => toggle("avgPos")}
                title={t.run.overview.colAvgPos}
              >
                {t.run.overview.colAvgPos}
                {arrow("avgPos")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.key} className="border-b last:border-b-0 dark:border-slate-800 align-top">
                <td className="px-3 py-1.5">
                  {isUrl ? (
                    <a
                      href={r.key}
                      target="_blank"
                      rel="noreferrer"
                      title={r.key}
                      className="text-blue-700 dark:text-blue-300 hover:underline break-all text-xs font-mono"
                    >
                      {r.key}
                    </a>
                  ) : (
                    <span className="break-all">{r.key}</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.count}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.avgPos.toFixed(1)}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-slate-600 dark:text-slate-400 text-xs">
                  {t.run.overview.noneForEngine}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
