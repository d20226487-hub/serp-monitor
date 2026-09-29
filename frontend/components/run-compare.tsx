"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { JobRun, Result, RunQuery } from "@/lib/api";
import { useT } from "@/lib/i18n";
import {
  byKeyword,
  compareVariants,
  countRows,
  crossDiffers,
  crossTab,
  engineScopes,
  providerSummaries,
  type CountRow,
  type CrossRow,
  type EngineScope,
  type KeywordCompare,
  type Mark,
  type Outcome,
  type VariantCompare,
} from "@/lib/compare";
import { providerLabel } from "@/lib/providers";
import { formatUsd } from "@/lib/cost";
import { Tip } from "@/components/tip";
import {
  Badge,
  Button,
  Callout,
  Card,
  DeviceChip,
  Pill,
  SectionTitle,
  Switch,
  TabBar,
} from "@/components/ui";

/**
 * Compare-mode run view: the same queries, sent to several providers, set side
 * by side. Three tables — domains, URLs, results per SERP — then every query's
 * SERPs next to each other, grouped by keyword and collapsed.
 *
 * The honesty rules (engines compared separately; totals over the queries
 * every provider answered) live in lib/compare.ts, where they are tested.
 */

// A result's relationship to the other providers' SERPs, as a wash. Amber and
// red keep the kit's meaning: a warning, and something missing.
const MARK_WASH: Record<Mark, string> = {
  same: "",
  solo: "",
  page: "bg-amber-50 dark:bg-amber-950/40",
  site: "bg-red-50 dark:bg-red-950/40",
};

const MARK_SWATCH: Record<Exclude<Mark, "solo">, string> = {
  same: "border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900",
  page: "border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/60",
  site: "border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/60",
};

const TH = "px-3 py-2 text-left text-xs font-medium text-slate-600 dark:text-slate-400";
const TH_SORT = `${TH} cursor-pointer select-none hover:text-slate-900 dark:hover:text-slate-100`;

export function RunCompare({
  run,
  results,
  queries,
  filter,
  onRetry,
  retrying,
  preferShown,
}: {
  run: JobRun;
  results: Result[];
  queries: RunQuery[];
  /** Keyword filter from the run page; narrows the per-SERP views. */
  filter: string;
  /** The job's "resolve AMP and CDN to the site shown" — read from the job's
   *  CURRENT setting, as the positions view does, so it stays reversible. */
  preferShown: boolean;
  onRetry: () => void;
  retrying: boolean;
}) {
  const { t } = useT();
  const providers = run.providers ?? [];
  const scopes = useMemo(() => engineScopes(providers, queries), [providers, queries]);
  const [engine, setEngine] = useState<string>("");
  const [onlyDiff, setOnlyDiff] = useState(false);

  // Default to the first engine the run has, and follow along if the set
  // changes while the run is still filling in.
  useEffect(() => {
    if (scopes.length && !scopes.some(s => s.engine === engine)) setEngine(scopes[0].engine);
  }, [scopes, engine]);

  const scope = scopes.find(s => s.engine === engine) ?? scopes[0];
  // Computed up here, unconditionally: hooks may not sit inside the branch
  // below, which renders nothing until the run has outcomes.
  const domainRows = useMemo(
    () => (scope ? crossTab(results, scope, "domain", run.provider, preferShown) : []),
    [results, scope, run.provider, preferShown],
  );
  const urlRows = useMemo(
    () => (scope ? crossTab(results, scope, "url", run.provider) : []),
    [results, scope, run.provider],
  );
  const summaries = useMemo(
    () => providerSummaries(providers, queries, run.provider_costs),
    [providers, queries, run.provider_costs],
  );
  const failed = summaries.reduce((n, s) => n + s.failed, 0);

  const engineLabel = (e: string) =>
    e === "google" ? t.run.overview.engineGoogle : e === "yandex" ? t.run.overview.engineYandex : e;

  return (
    <div className="space-y-5">
      <Card
        title={<SectionTitle icon="compare">{t.compare.summaryTitle}</SectionTitle>}
        actions={
          failed > 0 || retrying ? (
            <Button size="sm" onClick={onRetry} disabled={retrying}>
              {retrying ? t.compare.retrying : t.compare.retry(failed)}
            </Button>
          ) : undefined
        }
      >
        <ProviderSummaryTable summaries={summaries} />
      </Card>

      {!scope ? (
        <Callout tone="neutral">{t.compare.noRows}</Callout>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            {scopes.length > 1 ? (
              <div className="min-w-0 flex-1">
                <TabBar
                  label={t.compare.title}
                  tabs={scopes.map(s => ({ key: s.engine, label: engineLabel(s.engine), count: s.variants.length }))}
                  active={scope.engine}
                  onChange={setEngine}
                />
              </div>
            ) : <div />}
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={onlyDiff} onChange={setOnlyDiff} label={t.compare.onlyDifferences} />
              {t.compare.onlyDifferences}
            </label>
          </div>

          <BasisNote scope={scope} engine={engineLabel(scope.engine)} />
          {preferShown && <Callout tone="info" icon="info">{t.compare.shownHostOn}</Callout>}

          <CrossTable
            title={t.compare.domainsTitle}
            icon="globe"
            keyHeader={t.compare.colDomain}
            rows={domainRows}
            scope={scope}
            onlyDiff={onlyDiff}
            isUrl={false}
          />
          <CrossTable
            title={t.compare.urlsTitle}
            icon="link"
            keyHeader={t.compare.colUrl}
            rows={urlRows}
            scope={scope}
            onlyDiff={onlyDiff}
            isUrl
          />
          <CountsTable scope={scope} queries={queries} onlyDiff={onlyDiff} filter={filter} />
          <KeywordSerps
            scope={scope}
            results={results}
            queries={queries}
            runProvider={run.provider}
            onlyDiff={onlyDiff}
            filter={filter}
            preferShown={preferShown}
          />
          <p className="text-xs text-slate-600 dark:text-slate-400">{t.compare.footnote}</p>
        </>
      )}
    </div>
  );
}

function ProviderSummaryTable({ summaries }: { summaries: ReturnType<typeof providerSummaries> }) {
  const { t } = useT();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-800">
            <th className={TH}>{t.compare.colProvider}</th>
            <th className={`${TH} text-right`}>{t.compare.colAnswered}</th>
            <th className={`${TH} text-right`}>{t.compare.colFailed}</th>
            <th className={`${TH} text-right`}>{t.compare.colUnsupported}</th>
            <th className={`${TH} text-right`}>{t.compare.colResults}</th>
            <th className={`${TH} text-right`}>{t.compare.colAvgResults}</th>
            <th className={`${TH} text-right`}>{t.compare.colCost}</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map(s => {
            const sent = s.ok + s.failed + s.pending;
            return (
              <tr key={s.provider} className="border-b border-slate-100 last:border-b-0 dark:border-slate-800/60">
                <td className="px-3 py-2 font-medium">{providerLabel(s.provider)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.compare.answeredOf(s.ok, sent)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${s.failed ? "font-semibold text-red-700 dark:text-red-400" : "text-slate-500"}`}>
                  {s.failed}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{s.unsupported || "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.results}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.avgResults == null ? "—" : s.avgResults.toFixed(1)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {s.cost ? (
                    <span title={s.cost.source === "actual" ? t.cost.actualHint : t.cost.estimateHint}>
                      {formatUsd(s.cost.cost)}
                      {s.cost.source === "estimate" && (
                        <span className="text-slate-500 dark:text-slate-400"> ({t.cost.estimated})</span>
                      )}
                    </span>
                  ) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BasisNote({ scope, engine }: { scope: EngineScope; engine: string }) {
  const { t } = useT();
  if (scope.answering.length === 0) return <Callout tone="warn" icon="alert">{t.compare.nobodyAnswered(engine)}</Callout>;
  if (scope.answering.length === 1) return <Callout tone="warn" icon="alert">{t.compare.onlyOneAnswered(engine)}</Callout>;
  return (
    <Callout tone={scope.common.size === scope.variants.length ? "info" : "warn"} icon="info">
      {t.compare.basis(scope.common.size, scope.variants.length)}
    </Callout>
  );
}

/** The column header for a provider: its name, marked when it answered
 *  nothing for this engine and so takes no part in the comparison. */
function ProviderHead({ provider, scope }: { provider: string; scope: EngineScope }) {
  const { t } = useT();
  const answering = scope.answering.includes(provider);
  return (
    <span title={answering ? undefined : t.compare.noAnswersHint} className="inline-flex flex-col">
      <span>{providerLabel(provider)}</span>
      {!answering && <span className="text-[11px] font-normal text-red-600 dark:text-red-400">{t.compare.noAnswers}</span>}
    </span>
  );
}

type CrossSort = { key: string; dir: "asc" | "desc" };

function CrossTable({
  title, icon, keyHeader, rows, scope, onlyDiff, isUrl,
}: {
  title: string;
  icon: "globe" | "link";
  keyHeader: string;
  rows: CrossRow[];
  scope: EngineScope;
  onlyDiff: boolean;
  isUrl: boolean;
}) {
  const { t } = useT();
  const [sort, setSort] = useState<CrossSort>({ key: "__total", dir: "desc" });
  const n = scope.answering.length;

  const shown = useMemo(() => {
    const list = onlyDiff ? rows.filter(r => crossDiffers(r, scope)) : [...rows];
    const val = (r: CrossRow): number | string => {
      if (sort.key === "__label") return r.label;
      if (sort.key === "__total") return r.total;
      if (sort.key === "__found") return r.foundBy;
      return r.cells[sort.key]?.count ?? 0;
    };
    list.sort((a, b) => {
      const av = val(a), bv = val(b);
      let c = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      if (c === 0) c = b.total - a.total;
      return sort.dir === "asc" ? c : -c;
    });
    return list;
  }, [rows, onlyDiff, scope, sort]);

  const toggle = (key: string) =>
    setSort(s => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
      : { key, dir: key === "__label" || key === "__found" ? "asc" : "desc" }));
  const arrow = (key: string) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const differing = rows.filter(r => crossDiffers(r, scope)).length;

  return (
    <Card title={
      <SectionTitle icon={icon} count={`${differing}/${rows.length}`}>{title}</SectionTitle>
    }>
      {shown.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {onlyDiff && rows.length ? t.compare.noDifferences : t.compare.noRows}
        </p>
      ) : (
        <div className="max-h-[28rem] overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900">
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className={TH_SORT} onClick={() => toggle("__label")}>{keyHeader}{arrow("__label")}</th>
                {scope.providers.map(p => (
                  <th key={p} className={`${TH_SORT} text-right`} onClick={() => toggle(p)}>
                    <ProviderHead provider={p} scope={scope} />{arrow(p)}
                  </th>
                ))}
                <th className={`${TH_SORT} text-right`} onClick={() => toggle("__found")}>
                  {t.compare.colFoundBy}{arrow("__found")}
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const differs = crossDiffers(r, scope);
                return (
                  <tr key={r.key} className="border-b border-slate-100 align-top last:border-b-0 dark:border-slate-800/60">
                    <td className="max-w-[28rem] px-3 py-1.5">
                      {isUrl && r.href ? (
                        <a href={r.href} target="_blank" rel="noreferrer" title={r.href}
                          className="break-all font-mono text-xs text-blue-700 hover:underline dark:text-blue-300">
                          {r.label}
                        </a>
                      ) : (
                        <span className="break-all">
                          {r.label}
                          {r.substitutedFrom.length > 0 && (
                            <Tip
                              text={t.compare.substitutedRow(r.substitutedFrom.join(", "))}
                              label={t.positions.substituted}
                              className="ml-1 text-amber-700 dark:text-amber-400"
                            >
                              ⇄
                            </Tip>
                          )}
                        </span>
                      )}
                    </td>
                    {scope.providers.map(p => {
                      if (!scope.answering.includes(p)) {
                        return <td key={p} className="px-3 py-1.5 text-right text-slate-400">—</td>;
                      }
                      const c = r.cells[p];
                      if (!c) {
                        return (
                          <td key={p} title={t.compare.notReturned}
                            className="bg-red-50 px-3 py-1.5 text-right text-red-700 dark:bg-red-950/40 dark:text-red-400">
                            —
                          </td>
                        );
                      }
                      return (
                        <td key={p} className="px-3 py-1.5 text-right tabular-nums"
                          title={t.compare.cellHint(c.count, c.avgPos.toFixed(1), c.bestPos)}>
                          <span className="font-medium">{c.count}</span>
                          <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400">#{c.avgPos.toFixed(1)}</span>
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-right">
                      <Badge tone={differs ? "warn" : "good"}>{r.foundBy}/{n}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Device, place, language and Google domain of one query, as compact chips. */
function VariantChips({ v }: { v: CountRow["variant"] }) {
  const place = v.location || v.country_code?.toUpperCase();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <DeviceChip name={v.device} phone={v.device === "mobile"} />
      {place && <Badge>{place}</Badge>}
      {v.language && <Badge>{v.language}</Badge>}
      {v.google_domain && <Badge tone="info">{v.google_domain}</Badge>}
    </span>
  );
}

function OutcomeCell({ o }: { o: Outcome }) {
  const { t } = useT();
  if (o.status === "ok") return <span className="font-medium tabular-nums">{o.count}</span>;
  if (o.status === "failed") {
    return <span title={o.error ?? undefined}><Pill tone="bad" icon="cross">{t.compare.statusFailed}</Pill></span>;
  }
  if (o.status === "unsupported") {
    return <span title={t.compare.statusUnsupportedHint} className="text-slate-400">{t.compare.statusUnsupported}</span>;
  }
  return <span title={t.compare.statusPendingHint} className="text-slate-400">{t.compare.statusPending}</span>;
}

function CountsTable({
  scope, queries, onlyDiff, filter,
}: { scope: EngineScope; queries: RunQuery[]; onlyDiff: boolean; filter: string }) {
  const { t } = useT();
  const rows = useMemo(() => countRows(scope, queries), [scope, queries]);
  const f = filter.trim().toLowerCase();
  const shown = rows.filter(r => (!onlyDiff || r.differs) && (!f || r.variant.keyword.toLowerCase().includes(f)));
  const differing = rows.filter(r => r.differs).length;

  return (
    <Card title={<SectionTitle icon="list" count={`${differing}/${rows.length}`}>{t.compare.countsTitle}</SectionTitle>}>
      {shown.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {onlyDiff && rows.length ? t.compare.noDifferences : t.compare.noRows}
        </p>
      ) : (
        <div className="max-h-[28rem] overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900">
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className={TH}>{t.compare.colQuery}</th>
                {scope.providers.map(p => (
                  <th key={p} className={`${TH} text-right`}><ProviderHead provider={p} scope={scope} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.key}
                  className={`border-b border-slate-100 last:border-b-0 dark:border-slate-800/60 ${r.differs ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
                  <td className="px-3 py-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.variant.keyword}</span>
                      <VariantChips v={r.variant} />
                    </div>
                  </td>
                  {scope.providers.map(p => (
                    <td key={p} className="px-3 py-1.5 text-right"><OutcomeCell o={r.cells[p]} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Legend() {
  const { t } = useT();
  const item = (mark: Exclude<Mark, "solo">, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={`inline-block h-3 w-4 rounded-sm ${MARK_SWATCH[mark]}`} />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
      <span className="font-medium">{t.compare.legendTitle}:</span>
      {item("same", t.compare.markSame)}
      {item("page", t.compare.markPage)}
      {item("site", t.compare.markSite)}
    </div>
  );
}

function KeywordSerps({
  scope, results, queries, runProvider, onlyDiff, filter, preferShown,
}: {
  scope: EngineScope;
  results: Result[];
  queries: RunQuery[];
  runProvider?: string | null;
  onlyDiff: boolean;
  filter: string;
  preferShown: boolean;
}) {
  const { t } = useT();
  const keywords = useMemo(
    () => byKeyword(compareVariants(results, queries, scope, runProvider, preferShown)),
    [results, queries, scope, runProvider, preferShown],
  );
  const f = filter.trim().toLowerCase();
  const shown = keywords
    .filter(k => !f || k.keyword.toLowerCase().includes(f))
    .map(k => (onlyDiff ? { ...k, variants: k.variants.filter(v => v.differs) } : k))
    .filter(k => k.variants.length > 0);

  return (
    <Card title={<SectionTitle icon="keywords" count={keywords.length}>{t.compare.keywordsTitle}</SectionTitle>}>
      <div className="space-y-3">
        <Legend />
        {shown.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {onlyDiff && keywords.length ? t.compare.noDifferences : t.compare.noRows}
          </p>
        ) : (
          shown.map(k => <KeywordBlock key={k.keyword} k={k} />)
        )}
      </div>
    </Card>
  );
}

function KeywordBlock({ k }: { k: KeywordCompare }) {
  const { t } = useT();
  return (
    <details className="group rounded-lg border border-slate-200 dark:border-slate-800">
      <summary className="flex cursor-pointer select-none flex-wrap items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/40">
        <span className="text-slate-500 transition-transform group-open:rotate-90">▶</span>
        <span className="font-medium">{k.keyword}</span>
        <Badge tone={k.differing ? "warn" : "good"}>{t.compare.keywordSummary(k.variants.length, k.differing)}</Badge>
      </summary>
      <div className="space-y-4 border-t border-slate-200 p-3 dark:border-slate-800">
        {k.variants.map(v => <SerpGrid key={v.key} v={v} />)}
      </div>
    </details>
  );
}

function ColumnHead({ provider, outcome }: { provider: string; outcome: Outcome }) {
  const { t } = useT();
  let note: ReactNode = null;
  if (outcome.status === "failed") note = <span className="text-red-600 dark:text-red-400" title={outcome.error ?? undefined}>{t.compare.serpFailed}</span>;
  else if (outcome.status === "unsupported") note = <span className="text-slate-400">{t.compare.serpUnsupported}</span>;
  else if (outcome.status === "missing") note = <span className="text-slate-400">{t.compare.statusPending}</span>;
  else if (outcome.count === 0) note = <span className="text-amber-700 dark:text-amber-400">{t.compare.serpEmpty}</span>;
  else note = <span className="text-slate-500 dark:text-slate-400 tabular-nums">{outcome.count}</span>;
  return (
    <span className="flex items-baseline justify-between gap-2">
      <span>{providerLabel(provider)}</span>
      <span className="text-[11px] font-normal">{note}</span>
    </span>
  );
}

function SerpGrid({ v }: { v: VariantCompare }) {
  const { t } = useT();
  const rows = Array.from({ length: v.depth }, (_, i) => i);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <VariantChips v={v.variant} />
        {v.diffCount > 0 && <Badge tone="warn">≠ {v.diffCount}</Badge>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900/60">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className={`${TH} w-10`}>#</th>
              {v.columns.map(c => (
                <th key={c.provider} className={`${TH} min-w-[14rem]`}>
                  <ColumnHead provider={c.provider} outcome={c.outcome} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(i => (
              <tr key={i} className="border-b border-slate-100 align-top last:border-b-0 dark:border-slate-800/60">
                <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{i + 1}</td>
                {v.columns.map(c => {
                  const cell = c.rows[i];
                  if (!cell) return <td key={c.provider} className="px-3 py-1.5" />;
                  const r = cell.result;
                  const host = cell.host.host;
                  return (
                    <td key={c.provider} className={`px-3 py-1.5 ${MARK_WASH[cell.mark]}`}>
                      <div className="flex items-baseline gap-1.5">
                        {r.position !== i + 1 && (
                          <span className="font-mono text-[11px] text-slate-500">#{r.position}</span>
                        )}
                        <span className="truncate font-medium" title={host}>{host || "—"}</span>
                        {cell.host.substituted && (
                          <Tip
                            text={t.positions.substitutedHint(cell.host.host, cell.host.linked)}
                            label={t.positions.substituted}
                            className="shrink-0 text-amber-700 dark:text-amber-400"
                          >
                            ⇄
                          </Tip>
                        )}
                        {cell.host.unresolved && (
                          <Tip
                            text={t.positions.unresolvedHint}
                            label={t.positions.unresolvedHint}
                            className="shrink-0 text-slate-400"
                          >
                            ?
                          </Tip>
                        )}
                      </div>
                      {r.url && (
                        <a href={r.url} target="_blank" rel="noreferrer" title={r.url}
                          className="block truncate font-mono text-[11px] text-blue-700 hover:underline dark:text-blue-300">
                          {r.url}
                        </a>
                      )}
                      {r.title && <div className="truncate text-xs text-slate-600 dark:text-slate-400" title={r.title}>{r.title}</div>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
