"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  api, ProjectProxyChecker, ProxyCheckerConnection, ProxyCheckerMode, ToolDelivery,
} from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button, Callout, Card, Empty, Pill, SectionTitle, inputClass } from "@/components/ui";
import { Icon } from "@/components/icons";

/**
 * The Proxy Checker, in the two places it is set up (user, 2026-10-05):
 *
 * - Settings → Tools Connection holds the CONNECTION: where it lives and the
 *   token. One for the whole app.
 * - Each project's page holds WHEN that project's domains go: "let the user
 *   specify this on the project page".
 *
 * What goes, and the request's shape, is the backend's business — see
 * backend/app/proxy_checker.py.
 */

const MODES: ProxyCheckerMode[] = ["off", "after_run", "daily"];
const pad = (n: number) => String(n).padStart(2, "0");

/** The server keeps the daily time in UTC; people think in their own clock. */
export function utcToLocalTime(hhmm: string | null | undefined): string {
  if (!hhmm || !/^\d\d:\d\d$/.test(hhmm)) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setUTCHours(h, m, 0, 0);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localToUtcTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Server times here are UTC without saying so; read as local they are hours off. */
function serverTime(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}

function DeliveriesTable({ rows, showProject }: { rows: ToolDelivery[]; showProject: boolean }) {
  const { t } = useT();
  const s = t.tools.proxyChecker;
  if (rows.length === 0) return <Empty>{s.logEmpty}</Empty>;
  const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400";
  const TD = "px-3 py-2 align-top";
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900/50">
          <tr>
            <th className={TH}>{s.col.when}</th>
            {showProject && <th className={TH}>{s.col.project}</th>}
            <th className={TH}>{s.col.geo}</th>
            <th className={TH}>{s.col.domains}</th>
            <th className={TH}>{s.col.trigger}</th>
            <th className={TH}>{s.col.result}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {rows.map(r => (
            <tr key={r.id}>
              <td className={`${TD} whitespace-nowrap tabular-nums`}>{serverTime(r.sent_at)?.toLocaleString()}</td>
              {showProject && <td className={TD}>{r.project_name ?? "—"}</td>}
              <td className={`${TD} font-mono`}>{r.geo}</td>
              {/* The domains themselves, not a count: "what exactly went" is
                  the question this table exists to answer. */}
              <td className={`${TD} font-mono text-xs break-all`}>{r.domains.join(", ")}</td>
              <td className={`${TD} whitespace-nowrap`}>{s.trigger[r.trigger] ?? r.trigger}</td>
              <td className={TD}>
                {r.ok ? (
                  <Pill tone="good" icon="check">{s.accepted}</Pill>
                ) : (
                  <Pill tone="bad" icon="cross" title={r.response ?? undefined}>{s.refused(r.status_code)}</Pill>
                )}
                {!r.ok && r.response && (
                  <div className="mt-1 max-w-xs truncate text-xs text-slate-500 dark:text-slate-400" title={r.response}>
                    {r.response}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function modeLabel(
  s: ReturnType<typeof useT>["t"]["tools"]["proxyChecker"], mode: string, time: string | null | undefined,
): string {
  if (mode === "daily") return s.mode.daily(utcToLocalTime(time) || "—");
  return mode === "after_run" ? s.mode.after_run : s.mode.off;
}

/* ------------------------------------------------------------------ */
/* Settings → Tools Connection                                          */
/* ------------------------------------------------------------------ */

export function ProxyCheckerSettings({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useT();
  const s = t.tools.proxyChecker;
  const [data, setData] = useState<ProxyCheckerConnection | null>(null);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function take(next: ProxyCheckerConnection) {
    setData(next);
    setUrl(next.url);
  }
  useEffect(() => {
    api.getProxyChecker().then(take).catch(e => onError(e?.message ?? "Failed to load the Proxy Checker settings"));
  }, []);

  async function save() {
    setBusy(true); setMsg(null); onError(null);
    try {
      // The token is sent only when one was typed: an empty box means "keep
      // the one that is saved", never "erase it".
      take(await api.saveProxyChecker({ url: url.trim(), ...(token.trim() ? { token: token.trim() } : {}) }));
      setToken("");
      setMsg(t.common.saved);
    } catch (e: any) {
      onError(e?.message ?? "Save failed");
    } finally { setBusy(false); }
  }

  async function clear() {
    setBusy(true); setMsg(null); onError(null);
    try {
      take(await api.clearProxyChecker());
      setToken("");
      setMsg(t.common.cleared);
    } catch (e: any) {
      onError(e?.message ?? "Clear failed");
    } finally { setBusy(false); }
  }

  if (!data) return null;
  // Connected = an address and a token; either alone sends nothing.
  const connected = data.connected;
  const hasToken = data.token.configured;

  return (
    <Card
      title={<SectionTitle icon="shield">{s.title}</SectionTitle>}
      actions={
        connected
          ? <Pill tone="good" icon="check">{s.connected}</Pill>
          : <Pill tone="neutral" icon="dash">{s.notConnected}</Pill>
      }
    >
      <div className="space-y-5">
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{s.help}</p>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{s.url}</label>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder={s.urlPlaceholder}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{s.token}</label>
            {hasToken && (
              <div className="text-xs text-slate-600 dark:text-slate-400">
                {t.settings.providers.savedSecret(data.token.last4 ?? "", data.token.length ?? 0)}
              </div>
            )}
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder={s.tokenPlaceholder}
              className={inputClass}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={busy} onClick={save}>{t.common.save}</Button>
            <Button variant="danger" disabled={busy || !(hasToken || data.url)} onClick={clear}>{t.common.clear}</Button>
            {msg && (
              <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
                <Icon name="check" className="h-3.5 w-3.5" />{msg}
              </span>
            )}
          </div>
          {/* Only the connection lives here. When a project sends, what it
              would send and what it has sent are all on the project's own
              page — the user asked for it there, and a second copy in
              Settings read as if this were the place to set it. */}
          <p className="text-xs text-slate-500 dark:text-slate-400">{s.noTest}</p>
        </div>
      </div>
    </Card>
  );
}

export function AmpRotatorPlaceholder() {
  const { t } = useT();
  return (
    <Card
      title={<SectionTitle icon="refresh">{t.tools.ampRotator.title}</SectionTitle>}
      actions={<Pill tone="neutral" icon="clock">{t.tools.ampRotator.soon}</Pill>}
    >
      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">{t.tools.ampRotator.later}</p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* A project's page                                                     */
/* ------------------------------------------------------------------ */

export function ProjectProxyCheckerCard({ projectId, reloadKey = 0 }: {
  projectId: number;
  /** Bumped by the page when the project's GEOs were saved: the choice below
   *  is made among them, so it has to be read again. */
  reloadKey?: number;
}) {
  const { t } = useT();
  const s = t.tools.proxyChecker;
  const p = t.tools.project;
  const [data, setData] = useState<ProjectProxyChecker | null>(null);
  const [mode, setMode] = useState<ProxyCheckerMode>("off");
  const [time, setTime] = useState("09:00");          // local clock
  // Which of the project's GEOs to send. Kept as the plain list of switched-on
  // countries; "all of them" is told apart only when saving (see `save`).
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const savedChoice = (d: ProjectProxyChecker) =>
    d.geos === null ? d.project_geos : d.project_geos.filter(g => d.geos!.includes(g));

  function take(next: ProjectProxyChecker) {
    setData(next);
    setMode(next.mode);
    setChosen(savedChoice(next));
    if (next.time) setTime(utcToLocalTime(next.time) || "09:00");
  }
  useEffect(() => {
    api.getProjectProxyChecker(projectId).then(take).catch(e => setErr(e?.message ?? String(e)));
  }, [projectId, reloadKey]);

  async function save() {
    if (!data) return;
    setBusy(true); setMsg(null); setErr(null);
    try {
      take(await api.saveProjectProxyChecker(projectId, {
        mode, time: mode === "daily" ? localToUtcTime(time) : null,
        // Every GEO switched on is saved as "all", not as today's list: a GEO
        // added to the project later is then sent too, without coming back here.
        geos: data.project_geos.every(g => chosen.includes(g)) ? null : chosen,
      }));
      setMsg(t.common.saved);
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally { setBusy(false); }
  }

  async function sendNow() {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const res = await api.sendProjectProxyChecker(projectId);
      take(res);
      setMsg(res.sent.length === 0
        ? p.nothingToSend
        : p.sentResult(res.sent.filter(d => d.ok).length, res.sent.length));
    } catch (e: any) {
      setErr(e?.message ?? "Send failed");
    } finally { setBusy(false); }
  }

  if (!data) return err ? <Callout tone="bad" icon="alert">{err}</Callout> : null;

  const saved = savedChoice(data);
  const geosDirty = chosen.length !== saved.length || chosen.some(g => !saved.includes(g));
  const dirty = mode !== data.mode || (mode === "daily" && localToUtcTime(time) !== data.time) || geosDirty;
  // What would go, narrowed to the countries switched on right now — so
  // toggling one shows its effect before anything is saved.
  const geos = Object.keys(data.preview).filter(g => chosen.includes(g));
  const next = serverTime(data.next_run);
  const toggle = (g: string) => {
    setChosen(chosen.includes(g) ? chosen.filter(x => x !== g) : [...chosen, g]);
    setMsg(null);
  };

  return (
    <Card
      title={<SectionTitle icon="shield">{p.title}</SectionTitle>}
      actions={
        data.connected
          ? <Pill tone={data.mode === "off" ? "neutral" : "good"} icon={data.mode === "off" ? "dash" : "check"}>
              {modeLabel(s, data.mode, data.time)}
            </Pill>
          : <Pill tone="neutral" icon="dash">{s.notConnected}</Pill>
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{p.help}</p>

        {!data.connected && (
          <Callout tone="warn" icon="alert">
            {p.notConnected}{" "}
            <Link href="/settings#tools" className="underline">{p.connectLink}</Link>
          </Callout>
        )}

        <div className="space-y-2">
          <div className="text-sm font-medium">{p.when}</div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label={p.when}
              className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700"
            >
              {MODES.map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setMsg(null); }}
                  aria-pressed={mode === m}
                  className={`border-l px-2.5 py-1 text-xs transition first:border-l-0 dark:border-slate-700 ${
                    mode === m
                      ? "bg-slate-900 font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  }`}
                >
                  {m === "off" ? s.mode.off : m === "after_run" ? s.mode.after_run : p.modeDaily}
                </button>
              ))}
            </div>
            {mode === "daily" && (
              <label className="inline-flex items-center gap-1.5 text-xs">
                {p.time}
                <input
                  type="time"
                  value={time}
                  onChange={e => { setTime(e.target.value || "09:00"); setMsg(null); }}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>
            )}
            <Button variant="primary" size="sm" disabled={busy || !dirty} onClick={save}>{t.common.save}</Button>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {mode === "off" ? p.modeOffHint : mode === "after_run" ? p.modeAfterRunHint : p.modeDailyHint(data.window_hours)}
            {data.mode === "daily" && mode === "daily" && !dirty && next && (
              <> {p.nextRun(next.toLocaleString())}</>
            )}
          </p>
        </div>

        {/* Which of the project's GEOs (the card above) have their SERP
            findings sent. All on unless switched off. */}
        <div className="space-y-2">
          <div className="text-sm font-medium">{p.geos}</div>
          {data.project_geos.length === 0 ? (
            <p className="text-xs text-slate-600 dark:text-slate-400">{p.geosNone}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {data.project_geos.map(g => {
                const on = chosen.includes(g);
                const found = (data.preview[g] ?? []).length;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => toggle(g)}
                    aria-pressed={on}
                    title={p.geoFound(found, data.window_hours)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition ${
                      on
                        ? "border-slate-900 bg-slate-900 font-medium text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                        : "border-slate-300 text-slate-500 line-through hover:bg-slate-100 dark:border-slate-700 dark:text-slate-500 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span className="font-mono">{g}</span>
                    <span className={on ? "opacity-70" : ""}>{found}</span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {chosen.length === 0 && data.project_geos.length > 0 ? p.geosEmpty : p.geosHint}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={busy || !data.connected || geos.length === 0 || dirty}
            onClick={sendNow}
            title={dirty ? p.saveFirst : p.sendNowHint(data.window_hours)}
          >
            <Icon name="play" className="h-3.5 w-3.5" />
            {busy ? p.sending : p.sendNow}
          </Button>
          {msg && <span className="text-sm text-slate-700 dark:text-slate-300">{msg}</span>}
        </div>
        {err && <Callout tone="bad" icon="alert">{err}</Callout>}

        {/* Folded: the card sits at the top of the project page now, above the
            positions it draws on, and must not push them down the screen. */}
        <details className="group border-t pt-3 dark:border-slate-800">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium">
            <Icon name="chevronRight" className="h-3.5 w-3.5 transition group-open:rotate-90" />
            {p.previewTitle(data.window_hours)}
            <span className="font-normal text-slate-500 dark:text-slate-400">· {p.countries(geos.length)}</span>
          </summary>
          <div className="mt-2">
            {geos.length === 0 ? (
              <Empty>{p.previewEmpty(data.window_hours)}</Empty>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {geos.map(geo => (
                  <li key={geo} className="flex gap-2">
                    <span className="mt-0.5 w-9 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-center font-mono text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {geo}
                    </span>
                    <span className="min-w-0 break-all font-mono text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                      {data.preview[geo].join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>

        <details className="group border-t pt-3 dark:border-slate-800">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium">
            <Icon name="chevronRight" className="h-3.5 w-3.5 transition group-open:rotate-90" />
            {s.logTitle}
            <span className="font-normal text-slate-500 dark:text-slate-400">· {data.deliveries.length}</span>
          </summary>
          <div className="mt-2">
            <DeliveriesTable rows={data.deliveries} showProject={false} />
          </div>
        </details>
      </div>
    </Card>
  );
}
