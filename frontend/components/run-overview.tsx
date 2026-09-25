"use client";
import { useMemo } from "react";
import Link from "next/link";
import { Result } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { aggregate } from "@/lib/overview";
import { DistributionTable } from "@/components/distribution-table";

/**
 * Inline run-page overview: domain & URL frequency split per engine
 * (Google / Yandex shown separately). A quick at-a-glance view; the
 * "Full breakdown" link opens the dedicated page where the user can group by
 * any combination of engine / GEO / language / device.
 *
 * Pure client-side from the already-loaded results; reflects the FULL run,
 * independent of the keyword text filter on the grouped results below.
 */
export function RunOverview({ results, runId }: { results: Result[]; runId: number }) {
  const { t } = useT();

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
    <details className="border rounded-md dark:border-slate-700 group" open>
      <summary className="cursor-pointer select-none px-4 py-2.5 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-900/40">
        <span className="text-slate-600 dark:text-slate-300 group-open:rotate-90 transition-transform">▶</span>
        <span className="font-medium text-sm">{t.run.overview.title}</span>
        <span className="text-xs text-slate-600 dark:text-slate-400">{t.run.overview.hint}</span>
        <Link
          href={`/runs/${runId}/overview`}
          className="ml-auto text-xs text-blue-700 dark:text-blue-300 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {t.run.overview.fullBreakdown}
        </Link>
      </summary>
      <div className="border-t dark:border-slate-800 p-4 space-y-6">
        {engines.map((engine) => {
          const er = results.filter((r) => r.engine === engine);
          const domains = aggregate(er, "domain");
          const urls = aggregate(er, "url");
          return (
            <div key={engine} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h3 className="font-semibold text-sm">{engineLabel(engine)}</h3>
                <span className="text-xs text-slate-600 dark:text-slate-400">
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
