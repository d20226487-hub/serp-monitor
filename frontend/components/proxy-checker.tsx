"use client";
import { Fragment, useEffect, useState } from "react";
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

const MODES: ProxyCheckerMode[] = ["inherit", "off", "after_run", "daily"];
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

function CopyButton({ text }: { text: string }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      // No clipboard on a plain-http address: the text below can be selected.
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 text-xs text-slate-600 underline-offset-2 hover:underline dark:text-slate-400"
    >
      <Icon name={done ? "check" : "copy"} className="h-3 w-3" />
      {done ? t.tools.proxyChecker.exchange.copied : t.common.copy}
    </button>
  );
}

/**
 * One send, in full: the request as a curl command and the answer as it came
 * back (user, 2026-10-06). "Refused, HTTP 403" cannot be acted on; the curl
 * can be run or handed to whoever runs the Proxy Checker, and the answer's
 * headers usually say who refused.
 */
function Exchange({ d }: { d: ToolDelivery }) {
  const { t } = useT();
  const x = t.tools.proxyChecker.exchange;
  const PRE =
    "max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-xs leading-relaxed text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200";
  const LABEL = "text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400";
  const HINT = "text-xs text-slate-500 dark:text-slate-400";
  if (!d.curl) {
    return (
      <div className="space-y-1.5">
        <p className={HINT}>{x.notKept}</p>
        {d.response && <pre className={PRE}>{d.response}</pre>}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className={LABEL}>{x.request}</span>
          <CopyButton text={d.curl} />
        </div>
        <pre className={PRE}>{d.curl}</pre>
        <p className={HINT}>{x.tokenHidden}</p>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className={LABEL}>{d.status_code === null ? x.noResponse : x.response}</span>
          {d.response_raw && <CopyButton text={d.response_raw} />}
        </div>
        <pre className={PRE}>{d.response_raw || "—"}</pre>
      </div>
    </div>
  );
}

function DeliveriesTable({ rows, showProject }: { rows: ToolDelivery[]; showProject: boolean }) {
  const { t } = useT();
  const s = t.tools.proxyChecker;
  const [open, setOpen] = useState<number[]>([]);
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
            <Fragment key={r.id}>
            <tr>
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
                <button
                  type="button"
                  aria-expanded={open.includes(r.id)}
                  onClick={() => setOpen(o => (o.includes(r.id) ? o.filter(i => i !== r.id) : [...o, r.id]))}
                  className="mt-1 flex items-center gap-1 whitespace-nowrap text-xs text-slate-600 underline-offset-2 hover:underline dark:text-slate-400"
                >
                  <Icon name="chevronRight" className={`h-3 w-3 transition ${open.includes(r.id) ? "rotate-90" : ""}`} />
                  {open.includes(r.id) ? s.exchange.hide : s.exchange.show}
                </button>
              </td>
            </tr>
            {open.includes(r.id) && (
              <tr className="bg-slate-50/60 dark:bg-slate-900/30">
                <td colSpan={showProject ? 6 : 5} className="px-3 py-3">
                  <Exchange d={r} />
                </td>
              </tr>
            )}
            </Fragment>
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
  const [autoMsg, setAutoMsg] = useState<string | null>(null);
  // How long an answer is waited for, in minutes, as typed.
  const [wait, setWait] = useState("");

  function take(next: ProxyCheckerConnection) {
    setData(next);
    setUrl(next.url);
    setWait(String(next.timeout_minutes));
  }

  // Saved the moment it is clicked, on its own: the address and token above
  // have their own Save, and an address half-typed must not go with it.
  async function setAuto(on: boolean) {
    setBusy(true); setAutoMsg(null); onError(null);
    try {
      setData(await api.saveProxyChecker({ auto_after_run: on }));
      setAutoMsg(t.common.saved);
    } catch (e: any) {
      onError(e?.message ?? "Save failed");
    } finally { setBusy(false); }
  }
  useEffect(() => {
    api.getProxyChecker().then(take).catch(e => onError(e?.message ?? "Failed to load the Proxy Checker settings"));
  }, []);

  async function save() {
    if (!data) return;
    const [lo, hi] = data.timeout_range;
    const minutes = Number(wait);
    if (!Number.isInteger(minutes) || minutes < lo || minutes > hi) {
      onError(s.waitBad(lo, hi));
      return;
    }
    setBusy(true); setMsg(null); onError(null);
    try {
      // The token is sent only when one was typed: an empty box means "keep
      // the one that is saved", never "erase it".
      take(await api.saveProxyChecker({
        url: url.trim(), ...(token.trim() ? { token: token.trim() } : {}), timeout_minutes: minutes,
      }));
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
          {/* How long an answer is waited for (user, 2026-10-14: "Make it
              configurable in the setting: how long will we wait for the proxy
              checker"): a request with many domains takes longer to answer. */}
          <div className="space-y-1">
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{s.wait}</label>
            <div className="flex items-center gap-2">
              <div className="w-24">
                <input
                  type="number"
                  inputMode="numeric"
                  min={data.timeout_range[0]}
                  max={data.timeout_range[1]}
                  step={1}
                  value={wait}
                  onChange={e => setWait(e.target.value)}
                  className={inputClass}
                />
              </div>
              <span className="text-sm text-slate-600 dark:text-slate-400">{s.waitUnit}</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{s.waitHint(data.timeout_range[0], data.timeout_range[1])}</p>
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

        {/* The one schedule kept here: what a project on "As in Settings"
            does (user, 2026-10-14: "one setting for auto sending block checks
            to the proxy checker after CSV file upload or serp checks … The
            user should be able to still overwrite this setting on the project
            page. But default will be auto checks"). */}
        <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={data.auto_after_run}
              disabled={busy}
              onChange={e => setAuto(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-sky-600"
            />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">{s.auto}</span>
              <span className="block text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {s.autoHint}
                {autoMsg && (
                  <span className="ml-1.5 inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                    <Icon name="check" className="h-3 w-3" />{autoMsg}
                  </span>
                )}
              </span>
            </span>
          </label>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* A project's page                                                     */
/* ------------------------------------------------------------------ */

export function ProjectProxyCheckerCard({ projectId, reloadKey = 0, onChanged }: {
  projectId: number;
  /** Bumped by the page when the project's GEOs were saved: the choice below
   *  is made among them, so it has to be read again. */
  reloadKey?: number;
  /** Something was saved or sent here that the blocks table above reads. */
  onChanged?: () => void;
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
  // What "Send now" has just sent, shown in full under the button until the
  // next send or the next visit: the request and the answer are the point of
  // pressing it by hand.
  const [justSent, setJustSent] = useState<ToolDelivery[]>([]);

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
      onChanged?.();
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally { setBusy(false); }
  }

  async function sendNow() {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const res = await api.sendProjectProxyChecker(projectId);
      take(res);
      setJustSent(res.sent);
      onChanged?.();
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
          ? <Pill
              tone={data.effective_mode === "off" ? "neutral" : "good"}
              icon={data.effective_mode === "off" ? "dash" : "check"}
            >
              {modeLabel(s, data.effective_mode, data.time)}
              {data.mode === "inherit" && ` · ${p.bySettings}`}
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
                  {m === "inherit" ? p.modeInherit : m === "off" ? s.mode.off : m === "after_run" ? s.mode.after_run : p.modeDaily}
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
            {mode === "inherit"
              ? (data.auto_after_run ? p.modeInheritOn : p.modeInheritOff)
              : mode === "off" ? p.modeOffHint : mode === "after_run" ? p.modeAfterRunHint : p.modeDailyHint(data.window_hours)}
            {mode === "inherit" && (
              <> <Link href="/settings#tools" className="underline underline-offset-2">{p.settingsLink}</Link></>
            )}
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
                // What the SERPs there showed — the project's domains, and
                // AMP domains too. An AMP domain that only rides along with a
                // found domain is not counted as found.
                const found = data.preview_found[g] ?? 0;
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

        {/* Folded: the line beside the button already says how the send went;
            the requests and raw answers are for when that needs explaining
            (user, 2026-10-13: "If needed for debugging, the user will open it"). */}
        {justSent.length > 0 && (
          <details className="group/just rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-1.5 text-sm font-medium">
              <Icon name="chevronRight" className="h-3.5 w-3.5 transition group-open/just:rotate-90" />
              {s.exchange.justSent}
              <span className="font-normal text-slate-500 dark:text-slate-400">
                · {p.sentResult(justSent.filter(d => d.ok).length, justSent.length)}
              </span>
            </summary>
            <div className="mt-3 space-y-3">
            {justSent.map(d => (
              <details key={d.id} open className="group/sent">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm">
                  <Icon name="chevronRight" className="h-3.5 w-3.5 transition group-open/sent:rotate-90" />
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {d.geo}
                  </span>
                  {d.ok
                    ? <Pill tone="good" icon="check">{s.accepted}</Pill>
                    : <Pill tone="bad" icon="cross">{s.refused(d.status_code)}</Pill>}
                  <span className="min-w-0 break-all font-mono text-xs text-slate-600 dark:text-slate-400">
                    {d.domains.join(", ")}
                  </span>
                </summary>
                <div className="mt-2">
                  <Exchange d={d} />
                </div>
              </details>
            ))}
            </div>
          </details>
        )}

        {/* Open by default: what would go is what the "Send now" above it is
            pressed on. */}
        <details open className="group border-t pt-3 dark:border-slate-800">
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
                      {data.preview[geo].map((d, i) => (
                        <span key={d}>
                          {i > 0 && ", "}
                          {d}
                          {(data.preview_amp[geo] ?? []).includes(d) && (
                            <span className="ml-1 rounded bg-sky-100 px-1 py-px font-sans text-[10px] font-semibold text-sky-800 dark:bg-sky-950 dark:text-sky-300">AMP</span>
                          )}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {geos.some(g => (data.preview_amp[g] ?? []).length > 0) && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{p.previewAmpNote}</p>
            )}
          </div>
        </details>

        {/* The log is folded: it is looked at when something went wrong, and
            open it pushed everything below it down the tab (user, 2026-10-13:
            "should be hidden by default"). */}
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
