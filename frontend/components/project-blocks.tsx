"use client";
import { useEffect, useRef, useState } from "react";
import { api, BlockKind, BlockRow, ProjectBlocks } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button, Callout, Card, Empty, Pill, SectionTitle } from "@/components/ui";
import { Icon } from "@/components/icons";

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
 * Until a proxy has reported on any of the rows, the table opens on DEMO
 * statuses — the user asked to see it on mock data — under a banner that says
 * so. The rows themselves are always real.
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

const SEG = "border-l px-2.5 py-1 text-xs transition first:border-l-0 dark:border-slate-700";
const SEG_ON = "bg-slate-900 font-medium text-white dark:bg-slate-100 dark:text-slate-900";
const SEG_OFF = "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800";
const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400";
const TD = "px-3 py-2 align-top";

/** One proxy's word on one domain, as given. PASS is the one status known to
 *  mean the proxy reached the site; anything else is shown as a warning. */
function StatusCell({ status }: { status: string | undefined }) {
  if (!status) return <span className="text-slate-400 dark:text-slate-600">—</span>;
  const passed = status.trim().toUpperCase() === "PASS";
  return <Pill tone={passed ? "good" : "bad"} icon={passed ? "check" : "cross"}>{status}</Pill>;
}

export function ProjectBlocksCard({ projectId, reloadKey = 0 }: {
  projectId: number;
  /** Bumped when something this table reads has changed elsewhere on the
   *  page: the project's GEOs, the GEOs chosen for sending, or a send. */
  reloadKey?: number;
}) {
  const { t } = useT();
  const x = t.tools.blocks;
  const [days, setDays] = useState(7);
  const [demo, setDemo] = useState(false);
  const [data, setData] = useState<ProjectBlocks | null>(null);
  const [kind, setKind] = useState<"all" | BlockKind>("all");
  const [geo, setGeo] = useState("all");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Whether the first answer has been looked at: it decides if the table
  // opens on demo statuses, and after that the choice is the reader's.
  const decided = useRef(false);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    api.getProjectBlocks(projectId, days, demo)
      .then(next => {
        if (stale) return;
        if (!decided.current) {
          decided.current = true;
          if (!next.has_real && next.rows.length > 0) {
            setDemo(true);            // asked again with the example on
            return;
          }
        }
        setData(next);
        setErr(null);
      })
      .catch(e => { if (!stale) setErr(e?.message ?? String(e)); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [projectId, days, demo, reloadKey]);

  if (!data) return err ? <Callout tone="bad" icon="alert">{err}</Callout> : null;

  const shown = data.rows.filter(r => (kind === "all" || r.kind === kind) && (geo === "all" || r.geo === geo));
  const geosWithRows = data.geos.filter(g => data.rows.some(r => r.geo === g));
  const sections = geosWithRows
    .map(g => ({ geo: g, rows: shown.filter(r => r.geo === g), proxies: data.proxies[g] ?? [] }))
    .filter(s => s.rows.length > 0);

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
          <SectionTitle icon="shield" count={data.counts.in_serps}>{x.title}</SectionTitle>
          {data.demo && <Pill tone="warn" icon="alert">{x.demoBadge}</Pill>}
        </span>
      }
      actions={
        <div className="flex items-center gap-2">
          {loading && <Icon name="refresh" className="h-3 w-3 animate-spin text-slate-500" />}
          <div
            role="group"
            aria-label={x.periodHint}
            title={x.periodHint}
            className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700"
          >
            {data.windows.map(d => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                aria-pressed={days === d}
                className={`${SEG} ${days === d ? SEG_ON : SEG_OFF}`}
              >
                {x.period(d)}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{x.help}</p>

        {data.demo && (
          <Callout tone="warn" icon="alert" title={x.demoTitle}>
            <p>{x.demoText}</p>
            <Button size="sm" onClick={() => setDemo(false)}>{x.demoOff}</Button>
          </Callout>
        )}
        {!data.demo && !data.has_real && data.rows.length > 0 && (
          <Callout tone="info" icon="info">
            <p>{x.noReports}</p>
            <Button size="sm" onClick={() => setDemo(true)}>{x.demoOn}</Button>
          </Callout>
        )}
        {err && <Callout tone="bad" icon="alert">{err}</Callout>}

        {data.rows.length === 0 ? (
          <Empty>{x.empty(data.window_days)}</Empty>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label={x.filterLabel}
                className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700"
              >
                <button
                  type="button"
                  onClick={() => setKind("all")}
                  aria-pressed={kind === "all"}
                  className={`${SEG} ${kind === "all" ? SEG_ON : SEG_OFF}`}
                >
                  {x.all} <span className="opacity-70">{data.counts.in_serps}</span>
                </button>
                {KINDS.map(k => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    aria-pressed={kind === k}
                    title={x.filterHint[k]}
                    className={`${SEG} ${kind === k ? SEG_ON : SEG_OFF}`}
                  >
                    {x.filter[k]} <span className="opacity-70">{data.counts[k]}</span>
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
              <div key={s.geo} className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {s.geo}
                  </span>
                  <span className="font-medium">{x.domains(s.rows.length)}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {s.proxies.length > 0 ? x.proxies(s.proxies.length) : x.noProxies}
                  </span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-900/50">
                      <tr>
                        <th className={TH}>{x.col.domain}</th>
                        {/* One column per proxy of this country, named as the
                            Proxy Checker names it, minus the country it shares
                            with the table. */}
                        {s.proxies.map(p => (
                          <th key={p} className={`${TH} normal-case tracking-normal`} title={p}>
                            {proxyLabel(p, s.geo)}
                          </th>
                        ))}
                        <th className={`${TH} text-right`} title={x.keywordsHint}>{x.col.keywords}</th>
                        <th className={TH}>{x.col.best}</th>
                        <th className={TH}>{x.col.seen}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {s.rows.map(r => (
                        <tr key={r.domain}>
                          <td className={TD}>
                            <div className="break-all font-mono text-xs">{r.domain}</div>
                            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{note(r)}</div>
                          </td>
                          {s.proxies.map(p => (
                            <td key={p} className={`${TD} whitespace-nowrap`}>
                              <StatusCell status={r.proxies?.[p]} />
                            </td>
                          ))}
                          <td className={`${TD} text-right tabular-nums`}>{r.keywords}</td>
                          <td className={TD}>
                            <span className="font-semibold tabular-nums">#{r.best_position}</span>
                            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                              {r.best_keyword}
                              {" · "}
                              {r.engines.map(e => (e === "yandex" ? t.variantLabel.yandex : t.variantLabel.google)).join(", ")}
                            </div>
                          </td>
                          <td className={`${TD} whitespace-nowrap tabular-nums`}>{shortTime(r.last_seen)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </Card>
  );
}
