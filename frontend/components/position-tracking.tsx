"use client";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api, ProjectTracking, TrackingPoint, TrackingRow, TrackingSerp } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Card, Empty, ErrorNote, Pill, SectionTitle, inputClass, serverTime } from "@/components/ui";
import { Icon } from "@/components/icons";
import { DateRange, toQuery } from "@/lib/date-range";
import { oneOf, useSessionState } from "@/lib/session-state";
import { TrackingExport } from "@/components/tracking-export";
import {
  Change, ChangeKind, Compare, Dropped, Filters, NO_FILTERS, Sort, SortColumn, bandCount, bandStart, changeOf, dropped,
  droppedKeywords, isFilters, isSort, keep, serpExtras, sorted, spanOf,
} from "@/lib/position-tracking";

/**
 * Position Tracking: the Positions tab read the way a rank tracker reads it
 * (user, 2026-10-29: "I want to add more granular position tracking like in
 * rank trackers"), in the order asked for —
 *
 * 1. Overview: how many of the project's positions are in the top 3, 5 … 100
 *    of each search engine + GEO, against the previous check of every keyword
 *    or the previous period — a "Compare with" of its own (user: "Add the
 *    same filter to the Обзор"). Every position counts: three of the
 *    project's sites on one keyword add three.
 * 2. Filters: search engine, GEO, position (top N), change — measured against
 *    the previous check by default ("compared by default to the last
 *    upload"), or the previous period — and a search.
 * 3. A row per URL of the project's: keyword, GEO, search engine, position,
 *    best and average over the period, its readings as a sparkline, and the
 *    change; sortable by every column. A gear by "Keyword" chooses which of
 *    the others show (user, 2026-10-29: "add the gear icon where the user will
 *    be able to pick which columns to display"), remembered in this browser.
 *
 * Above the table, at the right of its title, the period chips again, bound to
 * the same choice as the ones at the top of the tab (the page passes them in
 * as `periodPicker`; user: "This should be above the table to the right of
 * Позиции").
 */

const PAGE = 100;

/** The table's columns besides the keyword, which every row is. */
type Column = "geo" | "engine" | "position" | "best" | "average" | "trend" | "change";
const COLUMNS: Column[] = ["geo", "engine", "position", "best", "average", "trend", "change"];
/** Which of them this browser hides, per project (user, 2026-10-29, after
 *  columns hidden in one project went in the others too: "Every project is
 *  distinct"): a viewer's preference, kept for each project apart. */
const hiddenKey = (projectId: number) => `serp-monitor:project:${projectId}:tracking-hidden-columns`;
/** Where the choice used to be kept, once for every project: no telling which
 *  project it was meant for, so it is dropped. */
const OLD_HIDDEN_KEY = "serp-monitor:tracking-hidden-columns";

/** The gear and its list of columns, each with a checkbox. The list is placed
 *  against the window, not the table: the table scrolls sideways in a box that
 *  would cut off anything hanging below its header. Closes on a click outside
 *  it, on Escape, and when the page scrolls from under it. */
function ColumnPicker({ hidden, onToggle, onShowAll }: {
  hidden: Column[]; onToggle: (c: Column) => void; onShowAll: () => void;
}) {
  const { t } = useT();
  const x = t.positions.tracking;
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const open = at !== null;
  const box = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = () => setAt(null);
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) close(); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  function toggle() {
    const r = button.current?.getBoundingClientRect();
    setAt(open || !r ? null : { top: r.bottom + 4, left: r.left });
  }
  return (
    <span ref={box} className="relative ml-1 inline-flex align-middle normal-case tracking-normal">
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={x.columnsHint}
        title={x.columnsHint}
        className={`rounded p-0.5 hover:bg-slate-200 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100 ${
          hidden.length > 0 ? "text-sky-700 dark:text-sky-400" : ""
        }`}
      >
        <Icon name="gear" className="h-3.5 w-3.5" />
      </button>
      {at && (
        <div
          style={{ top: at.top, left: at.left }}
          className="fixed z-30 w-48 rounded-lg border border-slate-200 bg-white p-2 text-sm font-normal text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <div className="px-1 pb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{x.columns}</div>
          {COLUMNS.map(c => (
            <label key={c} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">
              <input type="checkbox" checked={!hidden.includes(c)} onChange={() => onToggle(c)} />
              {x.col[c]}
            </label>
          ))}
          {hidden.length > 0 && (
            <button
              type="button"
              onClick={onShowAll}
              className="mt-1 w-full rounded px-1 py-1 text-left text-xs text-sky-700 hover:bg-slate-100 dark:text-sky-400 dark:hover:bg-slate-800"
            >
              {x.columnsAll}
            </button>
          )}
        </div>
      )}
    </span>
  );
}
const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400";
const TD = "px-3 py-2 align-top";
const HINT = "text-xs text-slate-500 dark:text-slate-400";
const SELECT = "rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

const dayMonth = (iso: string | null | undefined) =>
  serverTime(iso)?.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" }) ?? "";
const dayMonthTime = (iso: string | null | undefined) =>
  serverTime(iso)?.toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) ?? "";

/** "28.10" or "21.10–27.10": a period, its end being exclusive. */
function periodText(range: DateRange | null): string {
  if (!range) return "";
  const last = new Date(range.end.getTime() - 1);
  const f = (d: Date) => d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
  return f(range.start) === f(last) ? f(range.start) : `${f(range.start)}–${f(last)}`;
}

/** The URL's positions over the period's checks: the best at the top, a gap
 *  where it was not on the page. */
function Sparkline({ points }: { points: TrackingPoint[] }) {
  const { t } = useT();
  const W = 96, H = 24, PAD = 3;
  const values = points.map(p => p.position).filter((v): v is number => v !== null);
  if (values.length === 0) return <span className="text-slate-400 dark:text-slate-600">—</span>;
  const lo = Math.min(...values), hi = Math.max(...values);
  const xAt = (i: number) => (points.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (points.length - 1));
  const yAt = (v: number) => (hi === lo ? H / 2 : PAD + ((v - lo) * (H - 2 * PAD)) / (hi - lo));
  let path = "";
  let open = false;
  points.forEach((p, i) => {
    if (p.position === null) { open = false; return; }
    path += `${open ? "L" : "M"}${xAt(i).toFixed(1)} ${yAt(p.position).toFixed(1)} `;
    open = true;
  });
  // A reading with no neighbour on the page draws no line: it gets a dot.
  const lone = points
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => p.position !== null && points[i - 1]?.position == null && points[i + 1]?.position == null);
  const lastIndex = points.length - 1 - [...points].reverse().findIndex(p => p.position !== null);
  const title = t.positions.tracking.trendTitle(
    points.map(p => `${dayMonthTime(p.at)}: ${p.position ?? "—"}`).join(" · "),
  );
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}
      className="overflow-visible stroke-sky-600 text-sky-600 dark:stroke-sky-400 dark:text-sky-400">
      <title>{title}</title>
      <path d={path} fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {lone.map(({ p, i }) => <circle key={i} cx={xAt(i)} cy={yAt(p.position!)} r={1.75} fill="currentColor" stroke="none" />)}
      <circle cx={xAt(lastIndex)} cy={yAt(points[lastIndex].position!)} r={2.25} fill="currentColor" stroke="none" />
    </svg>
  );
}

/** ▲3 / ▼2 / = / new / dropped out / —. */
function ChangeCell({ change }: { change: Change }) {
  const { t } = useT();
  const x = t.positions.tracking;
  switch (change.kind) {
    case "up":
      return <span className="font-medium tabular-nums text-emerald-700 dark:text-emerald-400" title={x.was(change.was!)}>▲{change.delta}</span>;
    case "down":
      return <span className="font-medium tabular-nums text-rose-700 dark:text-rose-400" title={x.was(change.was!)}>▼{-change.delta!}</span>;
    case "same":
      return <span className="text-slate-500 dark:text-slate-400" title={x.was(change.was!)}>=</span>;
    case "new":
      return <Pill tone="info">{x.new}</Pill>;
    case "lost":
      return <span className="text-xs text-rose-700 dark:text-rose-400">{x.lost(change.was!)}</span>;
    default:
      return <span className="text-slate-400 dark:text-slate-600">—</span>;
  }
}

/** How many keywords had a URL leave the SERP from one top, with the URLs on
 *  hover; "—" when nothing can be compared. */
function DroppedCell({ found, beyond, beyondHint }: { found: Dropped[] | null; beyond: boolean; beyondHint: string }) {
  const { t } = useT();
  const SHOWN = 20;
  if (found === null) {
    return <td className={`${TD} text-right text-slate-400 dark:text-slate-600`}>—</td>;
  }
  const n = droppedKeywords(found);
  const lines = found.map(d => t.positions.tracking.droppedLine(d.keyword, d.url, d.was));
  const tone = beyond || n === 0 ? "text-slate-400 dark:text-slate-600" : "font-medium text-rose-700 dark:text-rose-400";
  return (
    <td
      className={`${TD} text-right tabular-nums ${tone}`}
      title={beyond ? beyondHint : n > 0 ? t.positions.tracking.droppedList(lines.slice(0, SHOWN), lines.length - SHOWN) : undefined}
    >
      {n}
    </td>
  );
}

/** A count and how it moved against what it is compared with. More positions
 *  in a top is better, so a gain is green. */
function CountCell({ now, before, beforeHint, beyond, beyondHint }: {
  now: number; before: number | null; beforeHint: (n: number) => string; beyond: boolean; beyondHint: string;
}) {
  const delta = before === null ? null : now - before;
  return (
    <td className={`${TD} whitespace-nowrap text-right tabular-nums`} title={beyond ? beyondHint : before !== null ? beforeHint(before) : undefined}>
      <span className={beyond ? "text-slate-400 dark:text-slate-600" : "font-medium"}>{now}</span>
      {delta !== null && delta !== 0 && (
        // Beyond the depth checked, the change only repeats the last column's.
        <span className={`ml-1.5 text-xs ${
          beyond ? "text-slate-400 dark:text-slate-600"
            : delta > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
        }`}>
          {delta > 0 ? `▲${delta}` : `▼${-delta}`}
        </span>
      )}
    </td>
  );
}

function SerpName({ serp, all }: { serp: TrackingSerp; all: TrackingSerp[] }) {
  const { t } = useT();
  const engine = t.variantLabel[serp.engine as "google" | "yandex"] ?? serp.engine;
  const extras = serpExtras(serp, all);
  return (
    <>
      <span>{engine}</span>
      <span className="mx-1 text-slate-400">·</span>
      <span className="font-mono">{(serp.country_code ?? "—").toUpperCase()}</span>
      {extras.length > 0 && <span className={`ml-1.5 ${HINT}`}>{extras.join(" · ")}</span>}
    </>
  );
}

export function PositionTracking({ projectId, range, previous, reloadKey = 0, periodPicker }: {
  projectId: number;
  /** null while a custom range is half-typed: nothing is asked for then. */
  range: DateRange | null;
  /** The previous calendar period, compared with. */
  previous: DateRange | null;
  /** Bumped when something this reads has changed (an upload). */
  reloadKey?: number;
  /** Beside the table's title: the period chips again, bound to the same choice. */
  periodPicker?: ReactNode;
}) {
  const { t } = useT();
  const x = t.positions.tracking;
  const [data, setData] = useState<ProjectTracking | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Kept for this browser tab, so a reload comes back to the same view.
  const stored = `serp-monitor:project:${projectId}:tracking-`;
  const [filters, setFilters] = useSessionState<Filters>(`${stored}filters`, NO_FILTERS, isFilters);
  // The Overview's own "Compare with", the previous check first as in the table.
  const [overviewCompare, setOverviewCompare] = useSessionState<Compare>(
    `${stored}overview-compare`, "check", oneOf(["check", "period"] as const));
  const [sort, setSort] = useSessionState<Sort>(`${stored}sort`, { column: "keyword", descending: false }, isSort);
  const [limit, setLimit] = useState(PAGE);
  const [hidden, setHidden] = useState<Column[]>([]);

  // Read back after mount, so the first render matches the server's — and
  // again for another project, whose choice is its own.
  useEffect(() => {
    let next: Column[] = [];
    try {
      localStorage.removeItem(OLD_HIDDEN_KEY);
      const saved: unknown = JSON.parse(localStorage.getItem(hiddenKey(projectId)) ?? "[]");
      if (Array.isArray(saved)) next = COLUMNS.filter(c => saved.includes(c));
    } catch {}
    setHidden(next);
  }, [projectId]);
  const show = (c: Column) => !hidden.includes(c);
  function pickColumns(next: Column[]) {
    setHidden(next);
    try { localStorage.setItem(hiddenKey(projectId), JSON.stringify(next)); } catch {}
    // A column taken away cannot keep ordering the rows unseen.
    if ((next as string[]).includes(sort.column)) setSort({ column: "keyword", descending: false });
  }

  useEffect(() => {
    if (!range) return;
    let stale = false;
    setLoading(true);
    api.projectTracking(projectId, toQuery(range), previous ? toQuery(previous) : null)
      .then(next => { if (!stale) { setData(next); setErr(null); } })
      .catch(e => { if (!stale) setErr(e?.message ?? String(e)); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [projectId, range, previous, reloadKey]);

  // Another filter or order starts the list from its top again.
  useEffect(() => { setLimit(PAGE); }, [filters, sort, data]);

  const serpByKey = useMemo(() => new Map((data?.serps ?? []).map(s => [s.key, s])), [data]);
  // Every URL row of each SERP, for the Overview's dropped-out table.
  const rowsBySerp = useMemo(() => {
    const out = new Map<string, TrackingRow[]>();
    for (const r of data?.rows ?? []) out.set(r.serp, [...(out.get(r.serp) ?? []), r]);
    return out;
  }, [data]);
  const shown = useMemo(() => {
    if (!data) return [];
    const kept = data.rows.filter(r => keep(r, serpByKey.get(r.serp), filters));
    return sorted(kept, sort, filters.compare, r => serpByKey.get(r.serp));
  }, [data, serpByKey, filters, sort]);
  const any = useMemo(() => (data?.rows ?? []).some(r => r.best !== null), [data]);

  const engines = useMemo(() => [...new Set((data?.serps ?? []).map(s => s.engine))].sort(), [data]);
  const geos = useMemo(
    () => [...new Set((data?.serps ?? []).map(s => (s.country_code ?? "").toUpperCase()).filter(Boolean))].sort(),
    [data],
  );
  const since = periodText(previous);
  const set = (patch: Partial<Filters>) => setFilters(f => ({ ...f, ...patch }));

  /** A column heading that sorts by its column; again to turn the order round. */
  function header(column: SortColumn, label: string, hint?: string, right?: boolean, extra?: ReactNode) {
    const active = sort.column === column;
    return (
      <th key={column} className={`${TH} ${right ? "text-right" : ""}`} title={hint} aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}>
        <button
          type="button"
          onClick={() => setSort(s => ({ column, descending: s.column === column ? !s.descending : false }))}
          className={`inline-flex items-center gap-1 uppercase hover:text-slate-900 dark:hover:text-slate-100 ${active ? "text-slate-900 dark:text-slate-100" : ""}`}
        >
          {label}
          <Icon name="chevronDown" className={`h-3 w-3 transition ${active ? "" : "opacity-30"} ${active && !sort.descending ? "rotate-180" : ""}`} />
        </button>
        {extra}
      </th>
    );
  }

  return (
    <div className="space-y-6">
      {err && <ErrorNote>{err}</ErrorNote>}

      {/* 1. Overview: the distribution by top N, per search engine + GEO. */}
      <Card
        title={<SectionTitle icon="activity">{x.overview}</SectionTitle>}
        actions={
          <div className="flex items-center gap-2">
            {loading && <Icon name="refresh" className="h-3.5 w-3.5 animate-spin text-slate-500" />}
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              {x.compare}
              <select
                className={SELECT}
                value={overviewCompare}
                onChange={e => setOverviewCompare(e.target.value as Compare)}
                title={overviewCompare === "check" ? x.compareCheckHint : x.comparePeriodHint(since)}
              >
                <option value="check">{x.compareCheck}</option>
                <option value="period">{x.comparePeriod}{since ? ` (${since})` : ""}</option>
              </select>
            </label>
          </div>
        }
      >
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium">{x.distribution}</div>
            <p className={HINT}>
              {x.distributionAbout}{" "}
              {overviewCompare === "check"
                ? (data?.serps.some(s => s.before_check) ? x.againstCheck : x.noCheck)
                : (data?.has_previous_period ? x.againstPeriod(since) : x.noPeriod)}
            </p>
          </div>
          {!data ? null : data.serps.length === 0 ? (
            <Empty>{x.empty}</Empty>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/50">
                  <tr>
                    <th className={TH}>{x.serpCol}</th>
                    <th className={`${TH} text-right`}>{x.keywordsCol}</th>
                    {data.thresholds.map(n => (
                      <th key={n} className={`${TH} text-right`}>
                        {x.top(n)}
                        <div className="font-normal normal-case tracking-normal">{x.band(bandStart(n, data.thresholds), n)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {data.serps.map(s => (
                    <tr key={s.key}>
                      <td className={`${TD} whitespace-nowrap`}><SerpName serp={s} all={data.serps} /></td>
                      <td className={`${TD} text-right tabular-nums`}>{s.keywords}</td>
                      {data.thresholds.map(n => (
                        <CountCell
                          key={n}
                          // By band, as the dropped table and the export (user,
                          // 2026-10-29: "Switch"): Топ 3 counts #2–3 only.
                          now={bandCount(s.now, n, data.thresholds)}
                          before={(() => {
                            const then = overviewCompare === "check" ? s.before_check : s.before;
                            return then ? bandCount(then, n, data.thresholds) : null;
                          })()}
                          beforeHint={overviewCompare === "check" ? x.beforeCheck : x.before}
                          beyond={s.depth > 0 && bandStart(n, data.thresholds) > s.depth}
                          beyondHint={x.beyondDepth(s.depth)}
                        />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* The keywords that dropped out of each top, against the same
              point the counts above are compared with. */}
          {data && data.serps.length > 0 && (
            <>
              <div className="pt-2">
                <div className="text-sm font-medium">{x.dropped}</div>
                <p className={HINT}>
                  {x.droppedAbout}{" "}
                  {data.serps.every(s => dropped([], s.keywords_best, 1, data.thresholds[0], overviewCompare) === null)
                    ? x.droppedNone
                    : overviewCompare === "check" ? x.droppedAgainstCheck : x.droppedAgainstPeriod(since)}
                </p>
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/50">
                    <tr>
                      <th className={TH}>{x.serpCol}</th>
                      <th className={`${TH} text-right`}>{x.keywordsCol}</th>
                      {data.thresholds.map(n => (
                        <th key={n} className={`${TH} text-right`}>
                          {x.top(n)}
                          <div className="font-normal normal-case tracking-normal">{x.band(bandStart(n, data.thresholds), n)}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {data.serps.map(s => (
                      <tr key={s.key}>
                        <td className={`${TD} whitespace-nowrap`}><SerpName serp={s} all={data.serps} /></td>
                        <td className={`${TD} text-right tabular-nums`}>{s.keywords}</td>
                        {data.thresholds.map(n => (
                          <DroppedCell
                            key={n}
                            found={dropped(
                              rowsBySerp.get(s.key) ?? [], s.keywords_best, bandStart(n, data.thresholds), n, overviewCompare,
                            )}
                            beyond={s.depth > 0 && n > s.depth}
                            beyondHint={x.beyondDepth(s.depth)}
                          />
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* 2. Filters and 3. the URLs. */}
      <Card
        title={<SectionTitle icon="list" count={data ? shown.length : undefined}>{t.positions.title}</SectionTitle>}
        actions={periodPicker}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              {x.engine}
              <select className={SELECT} value={filters.engine} onChange={e => set({ engine: e.target.value })}>
                <option value="all">{x.all}</option>
                {engines.map(e => <option key={e} value={e}>{t.variantLabel[e as "google" | "yandex"] ?? e}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              {x.geo}
              <select className={SELECT} value={filters.geo} onChange={e => set({ geo: e.target.value })}>
                <option value="all">{x.all}</option>
                {geos.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              {x.position}
              <select
                className={SELECT}
                value={String(filters.top)}
                onChange={e => set({ top: e.target.value === "all" ? "all" : Number(e.target.value) })}
              >
                <option value="all">{x.all}</option>
                {(data?.thresholds ?? []).map(n => <option key={n} value={n}>{x.top(n)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              {x.change}
              <select className={SELECT} value={filters.change} onChange={e => set({ change: e.target.value as ChangeKind | "all" })}>
                <option value="all">{x.all}</option>
                {(["up", "down", "same", "new", "lost"] as const).map(k => <option key={k} value={k}>{x.changeKinds[k]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              {x.compare}
              <select
                className={SELECT}
                value={filters.compare}
                onChange={e => set({ compare: e.target.value as Filters["compare"] })}
                title={filters.compare === "check" ? x.compareCheckHint : x.comparePeriodHint(since)}
              >
                <option value="check">{x.compareCheck}</option>
                <option value="period">{x.comparePeriod}{since ? ` (${since})` : ""}</option>
              </select>
            </label>
            <label className="ml-auto flex min-w-56 flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              <span className="sr-only">{x.search}</span>
              <span className="relative">
                <Icon name="search" className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={filters.query}
                  onChange={e => set({ query: e.target.value })}
                  placeholder={x.search}
                  className={`${inputClass} py-1 pl-7 text-xs`}
                />
              </span>
            </label>
            {data && (
              <TrackingExport
                data={data}
                compare={filters.compare}
                order={rows => sorted(rows, sort, filters.compare, r => serpByKey.get(r.serp))}
                since={since}
                range={range}
              />
            )}
          </div>

          {!data ? null : !any && shown.length === 0 ? (
            <Empty>{x.empty}</Empty>
          ) : shown.length === 0 ? (
            <Empty>{x.emptyFilter}</Empty>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/50">
                    <tr>
                      {header("keyword", x.col.keyword, undefined, false, (
                        <ColumnPicker
                          hidden={hidden}
                          onToggle={c => pickColumns(hidden.includes(c) ? hidden.filter(h => h !== c) : [...hidden, c])}
                          onShowAll={() => pickColumns([])}
                        />
                      ))}
                      {show("geo") && header("geo", x.col.geo)}
                      {show("engine") && header("engine", x.col.engine)}
                      {show("position") && header("position", x.col.position, x.positionHint, true)}
                      {show("best") && header("best", x.col.best, x.bestHint, true)}
                      {show("average") && header("average", x.col.average, x.averageHint, true)}
                      {show("trend") && <th className={TH}>{x.col.trend}</th>}
                      {show("change") && header("change", x.col.change, undefined, true)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {shown.slice(0, limit).map(r => {
                      const serp = serpByKey.get(r.serp);
                      // Best, average and the trend over the same span as the change.
                      const span = spanOf(r, filters.compare);
                      return (
                        <tr key={`${r.serp}|${r.keyword}|${r.url}`}>
                          <td className={TD}>
                            <div className="font-medium">{r.keyword}</div>
                            <a
                              href={r.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="block max-w-md break-all font-mono text-xs text-slate-600 hover:underline dark:text-slate-400"
                            >
                              {r.url}
                            </a>
                            {r.amp_of && (
                              <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                <span className="rounded bg-sky-100 px-1 py-px text-[10px] font-semibold text-sky-800 dark:bg-sky-950 dark:text-sky-300">AMP</span>
                                {x.ampOf(r.amp_of)}
                              </span>
                            )}
                          </td>
                          {show("geo") && <td className={`${TD} font-mono`}>{(serp?.country_code ?? "—").toUpperCase()}</td>}
                          {show("engine") && <td className={`${TD} whitespace-nowrap`}>
                            {serp ? (
                              <>
                                {t.variantLabel[serp.engine as "google" | "yandex"] ?? serp.engine}
                                {serpExtras(serp, data.serps).length > 0 && (
                                  <div className={HINT}>{serpExtras(serp, data.serps).join(" · ")}</div>
                                )}
                              </>
                            ) : "—"}
                          </td>}
                          {show("position") && <td className={`${TD} text-right font-semibold tabular-nums`} title={dayMonthTime(r.checked_at)}>
                            {r.position ?? <span className="font-normal text-slate-400 dark:text-slate-600">—</span>}
                          </td>}
                          {show("best") && <td className={`${TD} text-right tabular-nums`}>{span.best ?? "—"}</td>}
                          {/* How many checks the average stands on, on hover only
                              (user, 2026-10-29: the line under it "creates clutter"). */}
                          {show("average") && <td
                            className={`${TD} text-right tabular-nums`}
                            title={span.average !== null ? x.rankedIn(span.rankedIn, span.checks) : undefined}
                          >
                            {span.average ?? "—"}
                          </td>}
                          {show("trend") && <td className={TD}><Sparkline points={span.readings} /></td>}
                          {show("change") && <td className={`${TD} whitespace-nowrap text-right`}><ChangeCell change={changeOf(r, filters.compare)} /></td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className={HINT}>{x.shown(Math.min(limit, shown.length), shown.length)}</span>
                {shown.length > limit && (
                  <button
                    type="button"
                    onClick={() => setLimit(l => l + PAGE)}
                    className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {x.more(Math.min(PAGE, shown.length - limit))}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
