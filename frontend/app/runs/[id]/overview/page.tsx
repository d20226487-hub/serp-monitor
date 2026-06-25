"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, Result } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { aggregate, groupByDims, ALL_DIMS, Dim } from "@/lib/overview";
import { DistributionTable } from "@/components/distribution-table";

/**
 * Dedicated full-breakdown page for a run. Shows only distribution tables,
 * grouped by any chosen combination of engine / GEO / language / device.
 * One Domains + URLs table-pair per distinct combination present in the run.
 */
export default function RunOverviewPage() {
  const { t } = useT();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  // Default to the three the user asked for; device is opt-in.
  const [dims, setDims] = useState<Dim[]>(["engine", "geo", "language"]);

  useEffect(() => {
    let alive = true;
    api
      .getResults(id)
      .then((rows) => alive && setResults(rows))
      .catch(() => alive && setResults([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  const groups = useMemo(() => groupByDims(results, dims), [results, dims]);

  function toggleDim(d: Dim) {
    setDims((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  function dimLabel(d: Dim): string {
    return {
      engine: t.overviewPage.dimEngine,
      geo: t.overviewPage.dimGeo,
      language: t.overviewPage.dimLanguage,
      device: t.overviewPage.dimDevice,
    }[d];
  }

  // Localize the engine token inside a combination label; pass other dims through.
  function valueLabel(dim: Dim, value: string): string {
    if (dim === "engine") {
      if (value === "google") return t.run.overview.engineGoogle;
      if (value === "yandex") return t.run.overview.engineYandex;
    }
    return value;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{t.overviewPage.title(id)}</h1>
        <Link
          href={`/runs/${id}`}
          className="text-sm text-blue-700 dark:text-blue-300 hover:underline"
        >
          {t.overviewPage.back}
        </Link>
      </div>

      {/* Group-by selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-neutral-500">{t.overviewPage.groupBy}:</span>
        {ALL_DIMS.map((d) => {
          const on = dims.includes(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => toggleDim(d)}
              aria-pressed={on}
              className={`px-3 py-1 text-sm rounded-md border transition-colors ${
                on
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 border-neutral-900 dark:border-white"
                  : "border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              {dimLabel(d)}
            </button>
          );
        })}
        {!loading && (
          <span className="text-xs text-neutral-500 ml-1">
            {t.overviewPage.combinations(groups.length)}
          </span>
        )}
      </div>

      {loading && <div className="text-sm text-neutral-500">{t.common.loading}</div>}

      {!loading && results.length === 0 && (
        <div className="text-sm text-neutral-500 border rounded-md p-6 dark:border-neutral-700">
          {t.overviewPage.empty}
        </div>
      )}

      <div className="space-y-6">
        {groups.map((g) => {
          const domains = aggregate(g.rows, "domain");
          const urls = aggregate(g.rows, "url");
          return (
            <div key={g.key} className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-2">
                {g.values.length === 0 ? (
                  <span className="font-semibold text-sm">{t.overviewPage.allResults}</span>
                ) : (
                  g.values.map((v, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 border dark:border-neutral-700"
                    >
                      <span className="text-neutral-400">{dimLabel(dims[i])}:</span>
                      {valueLabel(dims[i], v)}
                    </span>
                  ))
                )}
                <span className="text-xs text-neutral-500">
                  {t.overviewPage.rowsInGroup(g.rows.length)}
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
    </div>
  );
}
