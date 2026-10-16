"use client";
import { useEffect, useMemo, useState } from "react";
import { api, BlockKind, BlockRow, ProjectBlocks, ProjectFailing } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button, Callout, Card, Empty, Pill, SectionTitle } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Tip } from "@/components/tip";
import { ampPeriodText } from "@/lib/amp-period";
import { RANGE_PRESETS, RangePreset, customRange, rangeFor, toInputValue, toQuery } from "@/lib/date-range";

/**
 * Which of the project's domains are in the SERPs, and the status each proxy
 * gives them (user, 2026-10-06: "understand which domains are blocked and are
 * in the SERPs").
 *
 * One table per country, because the proxies are that country's — the Proxy
 * Checker answers {"KG - Provider A": "PASS", "KG - Provider B": "PASS", …} per
 * domain — and each proxy is a column. Its status is shown as the Proxy
 * Checker worded it, not turned into a verdict of ours: "we do not show
 * blocked or not blocked we display the status by each proxy". Where a domain
 * ranks comes from the same reading the Positions tab shows.
 *
 * Two kinds of rows, in two tables (user, 2026-10-13: "One table for non-AMP
 * and one for AMP"): the project's own domains, and AMP domains. An AMP
 * domain is a row for either of two reasons (user, 2026-10-13: "Yes, send
 * them and show in Blocks"): a SERP shows it itself — then the row has its own
 * standing and says so — or it is the AMP domain of the day of a domain in the
 * SERPs, the host a visitor actually lands on, and stands where that domain
 * stands, which the row also says.
 *
 * The period is the one the Overview card and the positions use — today,
 * yesterday, this week … (user, 2026-10-13: "give the same time selection
 * options for consistency") — and it is about when the proxies answered: a
 * row's statuses are their newest answer inside the period.
 *
 * The table always opens on the REAL data. Demo statuses exist — the user
 * asked to see the table on mock data before the Proxy Checker had answered —
 * but only behind a button, never by default: opening on made-up statuses
 * was "very misleading" (user, 2026-10-13). The rows themselves are always
 * real.
 */

const KINDS: BlockKind[] = ["not_pass", "unchecked", "pass"];

/** Server times here are UTC without saying so; read as local they are hours off. */
function serverTime(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}
const shortTime = (iso: string | null | undefined) =>
  serverTime(iso)?.toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) ?? "";

/** "KG - Provider A" under the KG table is just "Provider A". A name that
 *  does not start with its country is shown whole. */
function proxyLabel(name: string, geo: string): string {
  const prefix = new RegExp(`^${geo}\\s*[-–—:]\\s*`, "i");
  return name.replace(prefix, "") || name;
}
const isPass = (status: string) => status.trim().toUpperCase() === "PASS";

const SEG = "border-l px-2.5 py-1 text-xs transition first:border-l-0 dark:border-slate-700";
const SEG_ON = "bg-slate-900 font-medium text-white dark:bg-slate-100 dark:text-slate-900";
const SEG_OFF = "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800";
const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400";
const TD = "px-3 py-2 align-top";
const HINT = "text-xs text-slate-500 dark:text-slate-400";
const DATE_INPUT = "rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";
const GEO_TAG = "rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200";

/** One proxy's word on one domain, as given. PASS is the one status known to
 *  mean the proxy reached the site; anything else is shown as a warning. */
function StatusCell({ status }: { status: string | undefined }) {
  if (!status) return <span className="text-slate-400 dark:text-slate-600">—</span>;
  return <Pill tone={isPass(status) ? "good" : "bad"} icon={isPass(status) ? "check" : "cross"}>{status}</Pill>;
}

/** Under an AMP domain: whose it is, since when the rotator has named it so
 *  (user, 2026-10-14: "give the date when the domain was AMP for the main
 *  domain"), and whether a SERP shows it itself. */
function AmpLine({ r }: { r: BlockRow }) {
  const { t } = useT();
  const x = t.tools.blocks;
  if (!r.main_domain) return null;
  const when = ampPeriodText(r.amp_period, t.positions.ampSince, t.positions.ampBefore);
  const fromConfig = r.amp_period?.source === "config";
  return (
    <div className={`mt-0.5 break-all ${HINT}`}>
      {x.ampOf(r.main_domain)}
      {when && (
        <>
          {" · "}
          <Tip
            text={fromConfig ? t.positions.ampConfigHint(r.main_domain, when) : t.positions.ampPeriodHint(r.main_domain, when)}
            className="whitespace-nowrap"
          >
            {when}
          </Tip>
        </>
      )}
      {r.own_standing && <>{" · "}{x.ampInSerps}</>}
    </div>
  );
}

/** Where the domain ranks: its best position, on which query and engines. */
function Standing({ r }: { r: BlockRow }) {
  const { t } = useT();
  // No SERP on record around the check shows it: nothing to say here.
  if (r.best_position === null || r.best_position === undefined) {
    return <span className="text-slate-400 dark:text-slate-600">—</span>;
  }
  // An AMP domain that no SERP shows itself stands where its main domain does.
  const viaMain = !!r.main_domain && !r.own_standing;
  return (
    <>
      <span className="font-semibold tabular-nums">#{r.best_position}</span>
      <div className={`mt-0.5 ${HINT}`}>
        {r.best_keyword}
        {" · "}
        {r.engines.map(e => (e === "yandex" ? t.variantLabel.yandex : t.variantLabel.google)).join(", ")}
        {viaMain && <>{" · "}{t.tools.blocks.viaMain}</>}
      </div>
    </>
  );
}

/** One country's matrix: a row per domain, a column per proxy. */
function StatusTable({ geo, rows, proxies, amp, note }: {
  geo: string; rows: BlockRow[]; proxies: string[]; amp: boolean; note: (r: BlockRow) => string;
}) {
  const { t } = useT();
  const x = t.tools.blocks;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900/50">
          <tr>
            <th className={TH}>{amp ? x.col.ampDomain : x.col.domain}</th>
            {/* One column per proxy of this country, named as the Proxy
                Checker names it, minus the country it shares with the table. */}
            {proxies.map(p => (
              <th key={p} className={`${TH} normal-case tracking-normal`} title={p}>{proxyLabel(p, geo)}</th>
            ))}
            <th className={`${TH} text-right`} title={x.keywordsHint}>{x.col.keywords}</th>
            <th className={TH}>{x.col.best}</th>
            <th className={TH}>{x.col.seen}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {rows.map(r => (
            <tr key={`${r.domain}|${r.main_domain ?? ""}`}>
              <td className={TD}>
                <div className="break-all font-mono text-xs">{r.domain}</div>
                <AmpLine r={r} />
                <div className={`mt-0.5 ${HINT}`}>{note(r)}</div>
              </td>
              {proxies.map(p => (
                <td key={p} className={`${TD} whitespace-nowrap`}><StatusCell status={r.proxies?.[p]} /></td>
              ))}
              <td className={`${TD} text-right tabular-nums`}>{r.keywords}</td>
              <td className={TD}><Standing r={r} /></td>
              <td className={`${TD} whitespace-nowrap tabular-nums`}>{shortTime(r.last_seen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProjectBlocksCard({ projectId, reloadKey = 0 }: {
  projectId: number;
  /** Bumped when something this table reads has changed elsewhere on the
   *  page: the project's GEOs, the GEOs chosen for sending, or a send. */
  reloadKey?: number;
}) {
  const { t } = useT();
  const x = t.tools.blocks;
  const [preset, setPreset] = useState<RangePreset>("today");
  const [from, setFrom] = useState(() => toInputValue(new Date()));
  const [to, setTo] = useState(() => toInputValue(new Date()));
  const [demo, setDemo] = useState(false);
  const [data, setData] = useState<ProjectBlocks | null>(null);
  const [kind, setKind] = useState<"all" | BlockKind>("all");
  const [geo, setGeo] = useState("all");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // null while a custom range is half-typed, which is the signal not to query.
  const range = useMemo(
    () => (preset === "custom" ? customRange(from, to) : rangeFor(preset)),
    [preset, from, to],
  );

  // `demo` is false until the reader presses "show an example": the table
  // never switches to made-up statuses on its own.
  useEffect(() => {
    if (!range) return;
    let stale = false;
    setLoading(true);
    api.getProjectBlocks(projectId, toQuery(range), demo)
      .then(next => {
        if (stale) return;
        setData(next);
        setErr(null);
      })
      .catch(e => { if (!stale) setErr(e?.message ?? String(e)); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [projectId, range, demo, reloadKey]);

  if (!data) return err ? <Callout tone="bad" icon="alert">{err}</Callout> : null;

  const keep = (r: BlockRow) => (kind === "all" || r.kind === kind) && (geo === "all" || r.geo === geo);
  const all = [...data.rows, ...data.amp_rows];
  const geosWithRows = data.geos.filter(g => all.some(r => r.geo === g));
  const sections = geosWithRows
    .map(g => ({
      geo: g,
      main: data.rows.filter(r => r.geo === g && keep(r)), proxies: data.proxies[g] ?? [],
      amp: data.amp_rows.filter(r => r.geo === g && keep(r)), ampProxies: data.amp_proxies[g] ?? [],
    }))
    .filter(s => s.main.length + s.amp.length > 0);
  // No proxy has reported on anything in this period (and the example is off):
  // there is a notice to show, and no table worth showing.
  const nothingChecked = !data.demo && !data.has_real && all.length > 0;
  // In the SERPs: the project's domains, and the AMP domains a SERP shows itself.
  const inSerps = data.counts.in_serps + data.amp_rows.filter(r => r.own_standing).length;
  // The filter counts cover both tables: the buttons filter both.
  const count = (k: "all" | BlockKind) =>
    k === "all" ? all.length : data.counts[k] + data.amp_counts[k];

  /** Under the domain: when the proxies reported, or why none has. */
  function note(r: BlockRow): string {
    if (r.proxies && Object.keys(r.proxies).length > 0) return x.checked(shortTime(r.checked_at));
    if (data!.demo) return x.unchecked;
    const why = !r.sending
      ? x.reason.geoOff
      : !r.last_send
        ? x.reason.neverSent
        : r.last_send.ok
          ? x.reason.notRead(shortTime(r.last_send.at))
          : x.reason.refused(shortTime(r.last_send.at), r.last_send.status_code);
    return `${x.unchecked}: ${why}`;
  }

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          <SectionTitle icon="shield" count={inSerps}>{x.title}</SectionTitle>
          {data.demo && <Pill tone="warn" icon="alert">{x.demoBadge}</Pill>}
        </span>
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {loading && <Icon name="refresh" className="h-3 w-3 animate-spin text-slate-500" />}
          <div
            role="group"
            aria-label={x.failingPeriod}
            title={x.periodHint}
            className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700"
          >
            {RANGE_PRESETS.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPreset(p)}
                aria-pressed={preset === p}
                className={`${SEG} ${preset === p ? SEG_ON : SEG_OFF}`}
              >
                {t.positions.presets[p]}
              </button>
            ))}
          </div>
          {preset === "custom" && (
            <span className="inline-flex items-center gap-1.5 text-xs">
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={DATE_INPUT} />
              <span className="text-slate-500 dark:text-slate-400">–</span>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} className={DATE_INPUT} />
            </span>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          {x.help}{data.has_amp && <> {x.helpAmp}</>}
        </p>

        {preset === "custom" && !range && (
          <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {t.positions.badRange}
          </div>
        )}
        {data.demo && (
          <Callout tone="warn" icon="alert" title={x.demoTitle}>
            <p>{x.demoText}</p>
            <Button size="sm" onClick={() => setDemo(false)}>{x.demoOff}</Button>
          </Callout>
        )}
        {nothingChecked && (
          <Callout tone="info" icon="info">
            <p>{x.noReports}</p>
            <Button size="sm" onClick={() => setDemo(true)}>{x.demoOn}</Button>
          </Callout>
        )}
        {err && <Callout tone="bad" icon="alert">{err}</Callout>}

        {/* With nothing checked the tables would be rows of dashes: the user
            asked for the notice alone ("It clutters the UX"). */}
        {nothingChecked ? null : all.length === 0 ? (
          <Empty>{x.empty}</Empty>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label={x.filterLabel}
                className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700"
              >
                {(["all", ...KINDS] as const).map(k => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    aria-pressed={kind === k}
                    title={k === "all" ? undefined : x.filterHint[k]}
                    className={`${SEG} ${kind === k ? SEG_ON : SEG_OFF}`}
                  >
                    {k === "all" ? x.all : x.filter[k]} <span className="opacity-70">{count(k)}</span>
                  </button>
                ))}
              </div>
              {geosWithRows.length > 1 && (
                <div
                  role="group"
                  aria-label="GEO"
                  className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700"
                >
                  {["all", ...geosWithRows].map(g => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGeo(g)}
                      aria-pressed={geo === g}
                      className={`${SEG} ${g === "all" ? "" : "font-mono"} ${geo === g ? SEG_ON : SEG_OFF}`}
                    >
                      {g === "all" ? x.allGeos : g}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {sections.length === 0 && <Empty>{x.emptyFilter}</Empty>}
            {sections.map(s => (
              <div key={s.geo} className="space-y-3">
                {s.main.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className={GEO_TAG}>{s.geo}</span>
                      <span className="font-medium">{x.domains(s.main.length)}</span>
                      <span className={HINT}>{s.proxies.length > 0 ? x.proxies(s.proxies.length) : x.noProxies}</span>
                    </div>
                    <StatusTable geo={s.geo} rows={s.main} proxies={s.proxies} amp={false} note={note} />
                  </div>
                )}
                {s.amp.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className={GEO_TAG}>{s.geo}</span>
                      <Pill tone="info">AMP</Pill>
                      <span className="font-medium">{x.ampDomains(s.amp.length)}</span>
                      <span className={HINT}>{s.ampProxies.length > 0 ? x.proxies(s.ampProxies.length) : x.noProxies}</span>
                    </div>
                    <StatusTable geo={s.geo} rows={s.amp} proxies={s.ampProxies} amp note={note} />
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Overview: what does not pass                                         */
/* ------------------------------------------------------------------ */

/** The proxies that did not say PASS for a row, each with its own word. */
function Failing({ r }: { r: BlockRow }) {
  const bad = Object.entries(r.proxies ?? {}).filter(([, status]) => !isPass(status));
  return (
    <div className="flex flex-wrap gap-1">
      {bad.map(([proxy, status]) => (
        <Pill key={proxy} tone="bad" icon="cross" title={proxy}>{proxyLabel(proxy, r.geo)}: {status}</Pill>
      ))}
    </div>
  );
}

function FailingTable({ rows, amp }: { rows: BlockRow[]; amp: boolean }) {
  const { t } = useT();
  const x = t.tools.blocks;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900/50">
          <tr>
            <th className={TH}>{amp ? x.col.ampDomain : x.col.domain}</th>
            <th className={TH}>GEO</th>
            <th className={TH}>{x.col.failing}</th>
            <th className={TH}>{x.col.best}</th>
            <th className={TH}>{x.col.checked}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {rows.map(r => (
            <tr key={`${r.geo}|${r.domain}|${r.main_domain ?? ""}`}>
              <td className={TD}>
                <div className="break-all font-mono text-xs">{r.domain}</div>
                <AmpLine r={r} />
              </td>
              <td className={`${TD} font-mono`}>{r.geo}</td>
              <td className={TD}><Failing r={r} /></td>
              <td className={TD}><Standing r={r} /></td>
              <td className={`${TD} whitespace-nowrap tabular-nums`}>{shortTime(r.checked_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * On the Overview, before the scheduled jobs (user, 2026-10-13: "show domains
 * that do not pass in Blocks. One table for non-AMP and one for AMP … show it
 * before Задачи по расписанию"): the domains in the SERPs that some proxy did
 * not pass, and nothing else.
 *
 * For a day or a period the reader picks — the same choices as the positions
 * tables ("let the user select the date to see the domains that do not pass").
 * Each domain is judged by its newest check INSIDE the period, as each query
 * there is shown by its newest run. Real data only: there is no demo here.
 */
export function ProjectNotPassingCard({ projectId, reloadKey = 0, onOpenBlocks }: {
  projectId: number;
  reloadKey?: number;
  /** Opens the Blocks tab, where every domain and every proxy is. */
  onOpenBlocks: () => void;
}) {
  const { t } = useT();
  const x = t.tools.blocks;
  const [preset, setPreset] = useState<RangePreset>("today");
  const [from, setFrom] = useState(() => toInputValue(new Date()));
  const [to, setTo] = useState(() => toInputValue(new Date()));
  const [data, setData] = useState<ProjectFailing | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // null while a custom range is half-typed, which is the signal not to query.
  const range = useMemo(
    () => (preset === "custom" ? customRange(from, to) : rangeFor(preset)),
    [preset, from, to],
  );

  useEffect(() => {
    if (!range) return;
    let stale = false;
    setLoading(true);
    api.getProjectFailing(projectId, toQuery(range))
      .then(next => { if (!stale) { setData(next); setErr(null); } })
      .catch(e => { if (!stale) setErr(e?.message ?? String(e)); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [projectId, range, reloadKey]);

  const main = data?.rows ?? [];
  const amp = data?.amp_rows ?? [];
  const total = main.length + amp.length;
  const anyChecks = !!data && (data.checked > 0 || data.amp_checked > 0);
  const link = (
    <button type="button" onClick={onOpenBlocks} className="underline underline-offset-2">{x.failingLink}</button>
  );

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          <SectionTitle icon="shield" count={data ? total : undefined}>{x.failingTitle}</SectionTitle>
          {data && (total > 0
            ? <Pill tone="bad" icon="alert">{x.failingSome(total)}</Pill>
            : anyChecks
              ? <Pill tone="good" icon="check">{x.failingNonePill}</Pill>
              : <Pill tone="neutral" icon="dash">{x.failingNoChecksPill}</Pill>)}
        </span>
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {loading && <Icon name="refresh" className="h-3 w-3 animate-spin text-slate-500" />}
          <div
            role="group"
            aria-label={x.failingPeriod}
            className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700"
          >
            {RANGE_PRESETS.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPreset(p)}
                aria-pressed={preset === p}
                className={`${SEG} ${preset === p ? SEG_ON : SEG_OFF}`}
              >
                {t.positions.presets[p]}
              </button>
            ))}
          </div>
          {preset === "custom" && (
            <span className="inline-flex items-center gap-1.5 text-xs">
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={DATE_INPUT} />
              <span className="text-slate-500 dark:text-slate-400">{"–"}</span>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} className={DATE_INPUT} />
            </span>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {preset === "custom" && !range && (
          <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {t.positions.badRange}
          </div>
        )}
        {err && <Callout tone="bad" icon="alert">{err}</Callout>}
        {data && (total === 0 ? (
          <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {anyChecks ? x.failingNone : x.failingNoChecks}
            {anyChecks && data.unchecked > 0 && <> {x.failingUnchecked(data.unchecked)}</>} {link}
          </p>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {x.failingHelp}
              {data.unchecked > 0 && <> {x.failingUnchecked(data.unchecked)}</>} {link}
            </p>
            <div className="space-y-1.5">
              <div className="text-sm font-medium">{x.failingMain(main.length)}</div>
              {main.length > 0 ? <FailingTable rows={main} amp={false} /> : <p className={HINT}>{x.failingNoneOfKind}</p>}
            </div>
            {data.has_amp && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Pill tone="info">AMP</Pill>{x.failingAmp(amp.length)}
                </div>
                {amp.length > 0 ? <FailingTable rows={amp} amp /> : <p className={HINT}>{x.failingNoneOfKind}</p>}
              </div>
            )}
          </>
        ))}
      </div>
    </Card>
  );
}
