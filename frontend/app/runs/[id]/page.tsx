"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { api, JobRun, Result, RunAnalysis, SavedLocation } from "@/lib/api";
import { RunAnalysisTable } from "@/components/run-analysis";
import { buildBrowserUrl, variantLabel } from "@/lib/browser-urls";
import { ExternalLink } from "lucide-react";
import { useT } from "@/lib/i18n";
import { Button, inputClass } from "@/components/ui";
import { RunOverview } from "@/components/run-overview";
import { RunPhases } from "@/components/run-phases";
import { formatUsd } from "@/lib/cost";

// One color per axis. Keyword wins the header; engine/device/location/language
// each get a distinctly-colored chip in the variant bar so you can scan a long
// run and immediately see *what differs* between two rows.
const KEYWORD_ACCENT = {
  border: "border-blue-200 dark:border-blue-900",
  borderL: "border-l-blue-500",
  header: "bg-blue-50 dark:bg-blue-950/40",
  dot: "bg-blue-500",
};

// Tailwind needs full class names in source for the JIT to pick them up,
// so the chip variants are spelled out as concrete strings here.
const CHIP = {
  engine:   "bg-violet-100  text-violet-800  dark:bg-violet-950/60  dark:text-violet-200  border-violet-200  dark:border-violet-900",
  device:   "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200 border-emerald-200 dark:border-emerald-900",
  location: "bg-amber-100   text-amber-900   dark:bg-amber-950/60   dark:text-amber-200   border-amber-200   dark:border-amber-900",
  language: "bg-rose-100    text-rose-800    dark:bg-rose-950/60    dark:text-rose-200    border-rose-200    dark:border-rose-900",
} as const;

function Chip({ kind, children }: { kind: keyof typeof CHIP; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${CHIP[kind]}`}>
      {children}
    </span>
  );
}

type VariantBucket = {
  key: string;
  engine: string;
  device: string;
  country: string | null;
  language: string | null;
  location: string | null;
  rows: Result[];
};

export default function RunPage() {
  const { t } = useT();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [run, setRun] = useState<JobRun | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [topExport, setTopExport] = useState(10);
  const [retrying, setRetrying] = useState(false);
  const [filterKw, setFilterKw] = useState<string>("");
  // canonical_name → SavedLocation, used to look up yandex_lr when building
  // browser-equivalent URLs for the verify section.
  const [lrByCanonical, setLrByCanonical] = useState<Map<string, number>>(new Map());
  // Null until loaded; `mode` inside tells us which view this run wants.
  const [analysis, setAnalysis] = useState<RunAnalysis | null>(null);

  async function load() {
    setRun(await api.getRun(id));
    setResults(await api.getResults(id));
    // Cheap even for serp-mode runs — returns mode + empty rows.
    try { setAnalysis(await api.getAnalysis(id)); } catch { /* keep last */ }
  }

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    api.listSavedLocations().then((rows: SavedLocation[]) => {
      const m = new Map<string, number>();
      for (const r of rows) if (r.yandex_lr != null) m.set(r.canonical_name, r.yandex_lr);
      setLrByCanonical(m);
    }).catch(() => {});
  }, []);

  // Queries that came back with nothing — a provider error on one variant
  // costs that keyword its SERP and everything downstream, while the rest of
  // the run is sound.
  const missingQueries = run ? Math.max(0, run.queries_total - run.queries_done) : 0;

  async function retryRun() {
    setRetrying(true);
    try {
      const r = await api.retryRun(id);
      if (!r.started) setRetrying(false);
    } catch {
      setRetrying(false);
    }
  }

  // The retry does not put the run back into "running" — it is topping up a
  // finished one — so the status poll below will not pick it up. Watch the
  // query counter instead, and stop when it stops moving.
  useEffect(() => {
    if (!retrying) return;
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > 20 * 60 * 1000) setRetrying(false);
      else load();
    }, 4000);
    return () => clearInterval(t);
  }, [retrying, id]);

  useEffect(() => {
    if (retrying && missingQueries === 0) setRetrying(false);
  }, [retrying, missingQueries]);

  // Live-poll while running
  useEffect(() => {
    if (!run || (run.status !== "running" && run.status !== "pending")) return;
    const t2 = setInterval(load, 3000);
    return () => clearInterval(t2);
  }, [run]);

  // Group results by keyword, then by structured variant (so we can render
  // each axis as its own colored chip rather than a stringified blob).
  const groups = useMemo(() => {
    const filtered = filterKw
      ? results.filter(r => r.keyword.toLowerCase().includes(filterKw.toLowerCase()))
      : results;
    const byKw = new Map<string, Result[]>();
    for (const r of filtered) {
      if (!byKw.has(r.keyword)) byKw.set(r.keyword, []);
      byKw.get(r.keyword)!.push(r);
    }
    return Array.from(byKw.entries()).map(([kw, rows]) => {
      const variants = new Map<string, VariantBucket>();
      for (const r of rows) {
        const key = [
          r.engine, r.device,
          r.country_code ?? "-", r.language ?? "-", r.location ?? "-",
        ].join("|");
        let bucket = variants.get(key);
        if (!bucket) {
          bucket = {
            key,
            engine: r.engine,
            device: r.device,
            country: r.country_code,
            language: r.language,
            location: r.location,
            rows: [],
          };
          variants.set(key, bucket);
        }
        bucket.rows.push(r);
      }
      return { keyword: kw, variants: Array.from(variants.values()) };
    });
  }, [results, filterKw]);

  function copyKeyword(kw: string) {
    const lines: string[] = [];
    const rows = results.filter(r => r.keyword === kw).sort((a, b) =>
      (a.engine + a.device + a.position).localeCompare(b.engine + b.device + b.position)
    );
    for (const r of rows) {
      lines.push([r.position, r.engine, r.device, r.url, r.title, r.description]
        .map(x => (x ?? "").toString().replace(/\t/g, " "))
        .join("\t"));
    }
    navigator.clipboard.writeText(lines.join("\n"));
  }

  function copyAll() {
    const header = ["keyword","engine","device","country","language","location","position","url","title","description"];
    const lines = [header.join("\t")];
    for (const r of results) {
      lines.push([r.keyword, r.engine, r.device, r.country_code ?? "", r.language ?? "",
                  r.location ?? "", r.position, r.url ?? "", r.title ?? "", r.description ?? ""]
        .map(x => x.toString().replace(/\t/g, " ")).join("\t"));
    }
    navigator.clipboard.writeText(lines.join("\n"));
  }

  // Distinct (keyword × variant) tuples — same `key` we already group results
  // by, but with the data needed to reconstruct the browser URL the user can
  // click to manually verify what Google/Yandex would return.
  const verifyEntries = useMemo(() => {
    const seen = new Set<string>();
    const entries: { keyword: string; key: string; url: string; label: string; engine: string }[] = [];
    for (const r of results) {
      const lr = r.location ? lrByCanonical.get(r.location) ?? null : null;
      const key = [
        r.keyword, r.engine, r.device, r.country_code ?? "-",
        r.language ?? "-", r.location ?? "-", r.google_domain ?? "-", lr ?? "-",
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const v = {
        keyword: r.keyword,
        engine: r.engine,
        device: r.device,
        country_code: r.country_code,
        language: r.language,
        location: r.location,
        google_domain: r.google_domain,
        yandex_lr: lr,
      };
      entries.push({
        keyword: r.keyword,
        key,
        url: buildBrowserUrl(v),
        label: variantLabel(v, t.variantLabel),
        engine: r.engine,
      });
    }
    return entries;
  }, [results, lrByCanonical, t]);

  // Group verify entries by keyword for readability (mirrors the results
  // section's structure).
  const verifyByKeyword = useMemo(() => {
    const m = new Map<string, typeof verifyEntries>();
    for (const e of verifyEntries) {
      if (!m.has(e.keyword)) m.set(e.keyword, []);
      m.get(e.keyword)!.push(e);
    }
    return Array.from(m.entries());
  }, [verifyEntries]);

  if (!run) return <div className="text-sm text-slate-600 dark:text-slate-400">{t.common.loading}</div>;

  const statusLabels = t.jobs.statusBadge as Record<string, string>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{t.run.title(run.id)}</h1>
        <span className="text-xs text-slate-600 dark:text-slate-400">
          {new Date(run.started_at).toLocaleString()} · {statusLabels[run.status] ?? run.status} · {t.run.headerStats(run.queries_done, run.queries_total)}
          {run.queries_failed > 0 && <span className="text-red-600 dark:text-red-400"> · {t.run.failed(run.queries_failed)}</span>}
          {run.cost != null && (
            <>
              {" · "}
              <span title={run.cost_source === "actual" ? t.cost.actualHint : t.cost.estimateHint}>
                {formatUsd(run.cost)}
                {run.cost_source === "estimate" && (
                  <span className="text-slate-500 dark:text-slate-400"> ({t.cost.estimated})</span>
                )}
              </span>
            </>
          )}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="text-sm">{t.run.exportTop}
            <input
              type="number" min={1} max={100} value={topExport}
              onChange={e => setTopExport(Number(e.target.value) || 10)}
              className={`${inputClass} ml-2 !w-16`}
            />
          </label>
          {/* Only analyzer runs have anything to report on. */}
          {analysis?.mode === "analyzer" && (
            <Link
              href={`/runs/${id}/report`}
              className="px-3 py-1.5 rounded-md border dark:border-slate-700 text-sm"
            >{t.report.open}</Link>
          )}
          <a
            href={api.exportUrl(id, topExport)}
            className="px-3 py-1.5 rounded-md bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-sm"
          >{t.run.downloadCsv}</a>
          <Button variant="ghost" onClick={copyAll}>{t.common.copyAll}</Button>
        </div>
      </div>

      <RunPhases run={run} analysis={analysis} />

      {run.error && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-800 dark:text-red-200 rounded-md px-3 py-2 text-sm">
          {run.error}
        </div>
      )}

      {(missingQueries > 0 || retrying) && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="text-amber-900 dark:text-amber-200">
            {t.run.missingQueries(missingQueries, run.queries_total)}
          </span>
          <span className="text-xs text-amber-800/80 dark:text-amber-200/70">
            {t.run.missingHint}
          </span>
          <button
            type="button"
            onClick={retryRun}
            disabled={retrying}
            className="ml-auto px-2.5 py-1 text-xs rounded-md border border-amber-400 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-60"
          >
            {retrying ? t.run.retrying : t.run.retryQueries(missingQueries)}
          </button>
        </div>
      )}

      <input
        value={filterKw}
        onChange={e => setFilterKw(e.target.value)}
        placeholder={t.run.filterPlaceholder}
        className={inputClass}
      />

      {/* Analyzer mode replaces the domain/URL distribution with the
          per-keyword difficulty table — different question, different view. */}
      {analysis?.mode === "analyzer" ? (
        // The analyzer table runs to twelve columns before its nested per-URL
        // and per-domain tables, which the page's max-w-6xl container clips.
        // Break out of that container and re-centre at a width the table can
        // actually use, rather than widening every form in the app to suit one
        // table. Capped so it stays readable on an ultrawide display.
        <div className="mx-[calc(50%-50vw)] w-screen px-4 sm:px-6">
          <div className="mx-auto w-full max-w-[1800px]">
            <RunAnalysisTable analysis={analysis} runId={id} onRefresh={load} />
          </div>
        </div>
      ) : (
        <RunOverview results={results} runId={id} />
      )}

      {verifyEntries.length > 0 && (
        <details className="group rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <summary className="cursor-pointer select-none px-4 py-2.5 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-900/40">
            <span className="text-slate-600 dark:text-slate-300 group-open:rotate-90 transition-transform">▶</span>
            <span className="font-medium text-sm">{t.run.verify.title}</span>
            <span className="text-xs text-slate-600 dark:text-slate-400">
              {t.run.verify.summary(verifyEntries.length)}
            </span>
          </summary>
          <div className="border-t dark:border-slate-800 p-4 space-y-4">
            {verifyByKeyword.map(([kw, entries]) => (
              <div key={kw}>
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  &ldquo;{kw}&rdquo;
                </div>
                <ul className="space-y-1.5">
                  {entries.map(e => (
                    <li key={e.key} className="flex flex-wrap items-baseline gap-2 text-xs">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded font-medium ${ e.engine ==="yandex"
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
                            : "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200"
                        }`}
                      >
                        {e.label}
                      </span>
                      <a
                        href={e.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-blue-700 dark:text-blue-300 hover:underline break-all inline-flex items-baseline gap-1"
                      >
                        {e.url}
                        <ExternalLink className="w-3 h-3 inline" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="text-xs text-slate-600 dark:text-slate-400 italic pt-2 border-t dark:border-slate-800">
              {t.run.verify.footer}
            </p>
          </div>
        </details>
      )}

      <div className="space-y-8">
        {groups.map(g => {
          const totalRows = g.variants.reduce((n, v) => n + v.rows.length, 0);
          return (
            // Collapsed by default: a 100-keyword run renders a thousand
            // result rows, and scrolling past all of them to reach the next
            // keyword is the common case, not reading them.
            <details
              key={g.keyword}
              className={`group rounded-lg border overflow-hidden border-l-4 ${KEYWORD_ACCENT.border} ${KEYWORD_ACCENT.borderL} dark:border-slate-700`}
            >
              <summary
                className={`px-5 py-3 flex items-center gap-3 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden ${KEYWORD_ACCENT.header}`}
              >
                <span className="text-slate-600 dark:text-slate-300 transition-transform group-open:rotate-90">▶</span>
                <span className={`inline-block w-2 h-2 rounded-full ${KEYWORD_ACCENT.dot}`} />
                <div className="font-semibold text-base">{g.keyword}</div>
                <span className="text-sm text-slate-600 dark:text-slate-300">
                  {t.run.groupCount(totalRows, g.variants.length)}
                </span>
                <Button variant="ghost"
                  onClick={e => {
                    // Inside a <summary>, a click would also toggle the panel.
                    e.preventDefault();
                    e.stopPropagation();
                    copyKeyword(g.keyword);
                  }}>{t.common.copy}</Button>
              </summary>
              <div className="bg-white dark:bg-slate-900">
                {g.variants.map((v, vi) => (
                  <div key={v.key} className={vi > 0 ? "border-t dark:border-slate-800" : ""}>
                    <div className="px-5 py-2 flex flex-wrap items-center gap-1.5 bg-slate-50 dark:bg-slate-900/60 border-b dark:border-slate-800">
                      <Chip kind="engine">{v.engine}</Chip>
                      <Chip kind="device">{v.device}</Chip>
                      {(v.country || v.location) && (
                        <Chip kind="location">
                          {v.country ? v.country.toUpperCase() : ""}
                          {v.country && v.location ? " · " : ""}
                          {v.location ?? ""}
                        </Chip>
                      )}
                      {v.language && <Chip kind="language">{v.language}</Chip>}
                    </div>
                    <table className="w-full text-sm">
                      <tbody>
                        {v.rows.sort((a, b) => a.position - b.position).map(r => (
                          <tr key={r.id} className="border-t first:border-t-0 dark:border-slate-800 align-top">
                            <td className="px-3 py-3 w-10 text-slate-600 dark:text-slate-400 font-mono">{r.position}</td>
                            <td className="px-3 py-3">
                              <a
                                href={r.url ?? "#"}
                                target="_blank" rel="noreferrer"
                                className="text-blue-700 dark:text-blue-300 hover:underline break-all text-xs"
                              >{r.url}</a>
                              {r.title && <div className="font-medium mt-0.5">{r.title}</div>}
                              {r.description && <div className="text-slate-600 dark:text-slate-400 mt-0.5">{r.description}</div>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </div>

      {groups.length === 0 && (
        <div className="text-sm text-slate-600 dark:text-slate-400">
          {run.status === "running" ? t.run.streaming : t.run.noResults}
        </div>
      )}
    </div>
  );
}
