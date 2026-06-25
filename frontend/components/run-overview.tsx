"use client";
import { useMemo, useState } from "react";
import { Result } from "@/lib/api";
import { useT } from "@/lib/i18n";

/**
 * Per-run distribution overview. Aggregates every result row in the run into
 * domain- and URL-frequency tables, split per search engine (Google / Yandex).
 *
 * "Count" = number of result rows carrying that domain/URL across all keywords
 * and variants in the run (the same domain appearing in 5 different keyword
 * searches counts 5). "Avg. position" = mean SERP rank over those rows.
 *
 * Pure client-side: the run page already loads all results, so this adds no
 * network cost. Reflects the FULL run, independent of the keyword text filter
 * applied to the grouped results below.
 */

type DistRow = { key: string; count: number; avgPos: number };
type SortKey = "count" | "avgPos";
type SortDir = "asc" | "desc";

function aggregate(results: Result[], field: "domain" | "url"): DistRow[] {
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

function DistributionTable({
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

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let cmp = sortKey === "count" ? a.count - b.count : a.avgPos - b.avgPos;
      if (cmp === 0) cmp = a.count - b.count; // stable-ish tiebreak by frequency
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Frequency defaults high→low; average position defaults best (low)→worst.
      setSortDir(key === "avgPos" ? "asc" : "desc");
    }
  }

  const arrow = (key: SortKey) =>
    key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const thBtn =
    "cursor-pointer select-none hover:text-neutral-900 dark:hover:text-neutral-100";

  return (
    <div className="border rounded-md dark:border-neutral-700 overflow-hidden">
      <div className="px-3 py-2 bg-neutral-50 dark:bg-neutral-900/50 border-b dark:border-neutral-800 flex items-baseline gap-2">
        <span className="font-medium text-sm">{title}</span>
        <span className="text-xs text-neutral-500">({rows.length})</span>
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white dark:bg-neutral-900 z-10">
            <tr className="border-b dark:border-neutral-800 text-left">
              <th className="px-3 py-2 font-medium text-neutral-500">{keyHeader}</th>
              <th
                className={`px-3 py-2 font-medium text-neutral-500 w-20 text-right ${thBtn}`}
                onClick={() => toggle("count")}
                title={t.run.overview.colCount}
              >
                {t.run.overview.colCount}
                {arrow("count")}
              </th>
              <th
                className={`px-3 py-2 font-medium text-neutral-500 w-24 text-right ${thBtn}`}
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
              <tr key={r.key} className="border-b last:border-b-0 dark:border-neutral-800 align-top">
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
                <td colSpan={3} className="px-3 py-4 text-center text-neutral-500 text-xs">
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

export function RunOverview({ results }: { results: Result[] }) {
  const { t } = useT();

  // Distinct engines actually present; Google then Yandex, then any others.
  const engines = useMemo(() => {
    const set = new Set(results.map((r) => r.engine).filter(Boolean));
    const preferred = ["google", "yandex"];
    return [
      ...preferred.filter((e) => set.has(e)),
      ...Array.from(set).filter((e) => !preferred.includes(e)).sort(),
    ];
  }, [results]);

  if (results.length === 0) return null;

  function engineLabel(engine: string): string {
    if (engine === "google") return t.run.overview.engineGoogle;
    if (engine === "yandex") return t.run.overview.engineYandex;
    return engine;
  }

  return (
    <details className="border rounded-md dark:border-neutral-700 group" open>
      <summary className="cursor-pointer select-none px-4 py-2.5 flex items-center gap-2 hover:bg-neutral-50 dark:hover:bg-neutral-900/40">
        <span className="text-neutral-400 group-open:rotate-90 transition-transform">▶</span>
        <span className="font-medium text-sm">{t.run.overview.title}</span>
        <span className="text-xs text-neutral-500">{t.run.overview.hint}</span>
      </summary>
      <div className="border-t dark:border-neutral-800 p-4 space-y-6">
        {engines.map((engine) => {
          const er = results.filter((r) => r.engine === engine);
          const domains = aggregate(er, "domain");
          const urls = aggregate(er, "url");
          return (
            <div key={engine} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h3 className="font-semibold text-sm">{engineLabel(engine)}</h3>
                <span className="text-xs text-neutral-500">
                  {t.run.overview.engineSummary(er.length)}
                </span>
              </div>
              <div className="grid lg:grid-cols-2 gap-4">
                <DistributionTable
                  title={t.run.overview.domainsTitle}
                  keyHeader={t.run.overview.colDomain}
                  rows={domains}
                  isUrl={false}
                />
                <DistributionTable
                  title={t.run.overview.urlsTitle}
                  keyHeader={t.run.overview.colUrl}
                  rows={urls}
                  isUrl={true}
                />
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}
