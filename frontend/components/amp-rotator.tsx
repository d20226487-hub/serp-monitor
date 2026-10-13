"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, AmpEndpoint, AmpRotatorState, Project, ProjectAmpDomains } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button, Callout, Card, Empty, Pill, SectionTitle, inputClass } from "@/components/ui";
import { Icon } from "@/components/icons";
import { localToUtcTime, utcToLocalTime } from "@/components/proxy-checker";

/**
 * AMP Rotator (user, 2026-10-13): "get today's AMP domain of each domain per
 * project".
 *
 * - Settings → Tools Connection holds the connection:
 *   - ONE login and password for every rotator ("All the AMP rotators have
 *     the same passwords … the same login and password I mean"), saved once
 *     at the top of the card;
 *   - the ENDPOINTS, added with a form that starts by choosing the project
 *     ("Each project will have their AMP rotator endpoint"), each with its
 *     own daily request time ("Make the time when the AMP rotator request is
 *     made configurable"). A project may have more than one — a rotator
 *     serves only its own sites.
 * - Each project's page shows what its endpoints answered: its domains and
 *   the AMP domain of each today.
 *
 * What is asked and how the answer is kept is the backend's business — see
 * backend/app/amp_rotator.py.
 */

/** Server times here are UTC without saying so; read as local they are hours off. */
function serverTime(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}
const shortTime = (iso: string | null | undefined) =>
  serverTime(iso)?.toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) ?? "";

const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400";
const TD = "px-3 py-2 align-top";
const LABEL = "block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400";
const HINT = "text-xs text-slate-500 dark:text-slate-400";
const BOX = "space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800";

/** How an endpoint's latest fetch went, in one pill and a line. */
function FetchResult({ e }: { e: AmpEndpoint }) {
  const { t } = useT();
  const x = t.tools.ampRotator;
  if (!e.fetched_at) return <span className={HINT}>{x.neverFetched}</span>;
  return (
    <div className="space-y-1">
      {e.ok
        ? <Pill tone={e.amp_count > 0 ? "good" : "warn"} icon={e.amp_count > 0 ? "check" : "alert"}>{x.fetchedOk(e.amp_count, e.sent ?? 0)}</Pill>
        : <Pill tone="bad" icon="cross">{x.fetchFailed(e.status_code)}</Pill>}
      <div className={HINT}>{shortTime(e.fetched_at)}</div>
      {!e.ok && e.error && (
        <div className="max-w-xs break-words text-xs text-slate-600 dark:text-slate-400">{e.error}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settings → Tools Connection                                          */
/* ------------------------------------------------------------------ */

/** `time` is in the reader's own clock; the server keeps UTC. */
type Draft = { id: number | null; project_id: number | ""; url: string; time: string };

export function AmpRotatorSettings({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useT();
  const x = t.tools.ampRotator;
  const [data, setData] = useState<AmpRotatorState | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  // The one login and password, as typed. The password box is empty unless
  // a new one is being entered: the saved one never comes back.
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // A new endpoint starts on the default time, shown in the reader's clock.
  const blank = (d: AmpRotatorState | null): Draft => ({
    id: null, project_id: "", url: "", time: utcToLocalTime(d?.default_time) || "07:00",
  });
  const [draft, setDraft] = useState<Draft>(blank(null));
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ where: "access" | "endpoint"; text: string } | null>(null);

  useEffect(() => {
    api.getAmpRotator()
      .then(next => { setData(next); setUsername(next.username); setDraft(blank(next)); })
      .catch(e => onError(e?.message ?? "Failed to load the AMP Rotator settings"));
    api.listProjects().then(setProjects).catch(() => {});
  }, []);

  /** One request at a time; the error, if any, goes to the page's error line. */
  async function run(action: () => Promise<AmpRotatorState>, done?: { where: "access" | "endpoint"; text: string }) {
    setBusy(true); setMsg(null); onError(null);
    try {
      const next = await action();
      setData(next);
      if (done) setMsg(done);
      return next;
    } catch (e: any) {
      onError(e?.message ?? "Request failed");
      return null;
    } finally { setBusy(false); }
  }

  async function saveAccess() {
    // The password is sent only when one was typed: an empty box means "keep
    // the one that is saved", never "erase it".
    const next = await run(
      () => api.saveAmpCredentials({ username: username.trim(), ...(password ? { password } : {}) }),
      { where: "access", text: t.common.saved },
    );
    if (next) { setUsername(next.username); setPassword(""); }
  }

  async function clearAccess() {
    if (!confirm(x.accessClearConfirm)) return;
    const next = await run(() => api.clearAmpCredentials(), { where: "access", text: t.common.cleared });
    if (next) { setUsername(""); setPassword(""); }
  }

  async function submit() {
    if (draft.project_id === "") return;
    const body = { project_id: draft.project_id, url: draft.url.trim(), time: localToUtcTime(draft.time) };
    const next = draft.id === null
      ? await run(() => api.addAmpEndpoint(body), { where: "endpoint", text: x.added })
      : await run(() => api.editAmpEndpoint(draft.id!, body), { where: "endpoint", text: t.common.saved });
    if (next) setDraft(blank(next));
  }

  async function fetchNow(id: number) {
    setFetching(id);
    await run(() => api.fetchAmpEndpoint(id));
    setFetching(null);
  }

  if (!data) return null;
  const editing = draft.id !== null;
  const accessDirty = username.trim() !== data.username || password !== "";
  const accessReady = username.trim() !== "" && (data.has_password || password !== "");
  const ready = draft.project_id !== "" && draft.url.trim() !== "" && /^\d\d:\d\d$/.test(draft.time);
  const saved = (where: "access" | "endpoint") => msg?.where === where && (
    <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
      <Icon name="check" className="h-3.5 w-3.5" />{msg.text}
    </span>
  );

  return (
    <Card
      title={<SectionTitle icon="refresh" count={data.endpoints.length || undefined}>{x.title}</SectionTitle>}
      actions={
        data.ready && data.endpoints.length > 0
          ? <Pill tone="good" icon="check">{x.connected(data.endpoints.length)}</Pill>
          : <Pill tone="neutral" icon="dash">{x.notConnected}</Pill>
      }
    >
      <div className="space-y-5">
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{x.help}</p>

        {/* One login and password for every rotator. */}
        <div className={BOX}>
          <div className="text-sm font-medium">{x.access}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className={LABEL}>{x.login}</label>
              <input
                value={username}
                autoComplete="off"
                onChange={e => { setUsername(e.target.value); setMsg(null); }}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL}>{x.password}</label>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={e => { setPassword(e.target.value); setMsg(null); }}
                placeholder={data.has_password ? x.passwordKeep : ""}
                className={inputClass}
              />
              <div className={HINT}>{data.has_password ? x.passwordSaved : x.passwordMissing}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={busy || !accessDirty || !accessReady} onClick={saveAccess}>{t.common.save}</Button>
            <Button variant="danger" disabled={busy || !(data.username || data.has_password)} onClick={clearAccess}>{t.common.clear}</Button>
            {saved("access")}
          </div>
          <p className={HINT}>{x.accessHint}</p>
        </div>

        {!data.ready && data.endpoints.length > 0 && (
          <Callout tone="warn" icon="alert">{x.accessNeeded}</Callout>
        )}

        {data.endpoints.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50">
                <tr>
                  <th className={TH}>{x.col.project}</th>
                  <th className={TH}>{x.col.endpoint}</th>
                  <th className={TH}>{x.col.time}</th>
                  <th className={TH}>{x.col.last}</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.endpoints.map(e => (
                  <tr key={e.id} className={draft.id === e.id ? "bg-sky-50/60 dark:bg-sky-950/20" : ""}>
                    <td className={`${TD} font-medium`}>
                      <Link href={`/projects/${e.project_id}`} className="hover:underline">{e.project_name ?? `#${e.project_id}`}</Link>
                    </td>
                    <td className={`${TD} break-all font-mono text-xs`}>{e.url}</td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <div className="font-semibold tabular-nums">{utcToLocalTime(e.time) || "—"}</div>
                      {serverTime(e.next_run) && <div className={`mt-0.5 ${HINT}`}>{x.nextRun(shortTime(e.next_run))}</div>}
                    </td>
                    <td className={TD}><FetchResult e={e} /></td>
                    <td className={`${TD} whitespace-nowrap text-right`}>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button
                          size="sm"
                          disabled={busy || !data.ready}
                          title={data.ready ? undefined : x.accessNeeded}
                          onClick={() => fetchNow(e.id)}
                        >
                          <Icon name="refresh" className={`h-3.5 w-3.5 ${fetching === e.id ? "animate-spin" : ""}`} />
                          {fetching === e.id ? x.fetching : x.fetchNow}
                        </Button>
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setMsg(null);
                            setDraft({ id: e.id, project_id: e.project_id, url: e.url, time: utcToLocalTime(e.time) || "07:00" });
                          }}
                        >
                          {t.common.edit}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busy}
                          onClick={() => {
                            if (!confirm(x.deleteConfirm(e.project_name ?? `#${e.project_id}`))) return;
                            if (draft.id === e.id) setDraft(blank(data));
                            run(() => api.deleteAmpEndpoint(e.id));
                          }}
                        >
                          {t.common.delete}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* The form the user asked for: choose the project, then say where its
            rotator is and when to ask it. The same form edits a row. */}
        <div className={BOX}>
          <div className="text-sm font-medium">{editing ? x.formEdit : x.formAdd}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className={LABEL}>{x.col.project}</label>
              <select
                value={draft.project_id}
                onChange={e => setDraft({ ...draft, project_id: e.target.value ? Number(e.target.value) : "" })}
                className={inputClass}
              >
                <option value="">{x.chooseProject}</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className={LABEL}>{x.col.endpoint}</label>
              <input
                value={draft.url}
                onChange={e => setDraft({ ...draft, url: e.target.value })}
                placeholder="https://<rotator-host>/api/"
                className={`${inputClass} font-mono`}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL}>{x.time}</label>
              <input
                type="time"
                value={draft.time}
                onChange={e => setDraft({ ...draft, time: e.target.value })}
                className={inputClass}
              />
              <p className={HINT}>{x.timeHint}</p>
            </div>
          </div>
          {projects.length === 0 && <p className={HINT}>{x.noProjects}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={busy || !ready} onClick={submit}>
              {editing ? t.common.save : t.common.add}
            </Button>
            {editing && <Button disabled={busy} onClick={() => setDraft(blank(data))}>{t.common.cancel}</Button>}
            {saved("endpoint")}
          </div>
          <p className={HINT}>{x.formHint}</p>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* A project's page                                                     */
/* ------------------------------------------------------------------ */

export function ProjectAmpCard({ projectId }: { projectId: number }) {
  const { t } = useT();
  const x = t.tools.ampRotator;
  const [data, setData] = useState<ProjectAmpDomains | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getProjectAmpDomains(projectId).then(setData).catch(e => setErr(e?.message ?? String(e)));
  }, [projectId]);

  async function refresh() {
    setBusy(true); setErr(null);
    try {
      setData(await api.refreshProjectAmpDomains(projectId));
    } catch (e: any) {
      setErr(e?.message ?? "Refresh failed");
    } finally { setBusy(false); }
  }

  // A project with no rotator has nothing to show here, and most projects
  // have none: no empty card on their pages.
  if (!data || data.endpoints.length === 0) return err ? <Callout tone="bad" icon="alert">{err}</Callout> : null;

  const failed = data.endpoints.filter(e => e.fetched_at && !e.ok);
  const never = data.endpoints.every(e => !e.fetched_at);
  const latest = data.endpoints.map(e => e.fetched_at).filter(Boolean).sort().pop();
  const several = data.endpoints.length > 1;

  return (
    <Card
      title={<SectionTitle icon="refresh" count={data.rows.length}>{x.projectTitle}</SectionTitle>}
      actions={
        <div className="flex items-center gap-2">
          {latest && <span className={HINT}>{x.fetchedAt(shortTime(latest))}</span>}
          <Button size="sm" disabled={busy} onClick={refresh}>
            <Icon name="refresh" className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
            {busy ? x.fetching : x.fetchNow}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          {x.projectHelp}{" "}
          <Link href="/settings#tools" className="underline">{x.settingsLink}</Link>
        </p>
        {err && <Callout tone="bad" icon="alert">{err}</Callout>}
        {failed.map(e => (
          <Callout key={e.id} tone="warn" icon="alert">
            {x.projectFailed(e.url, shortTime(e.fetched_at))} {e.error}
          </Callout>
        ))}
        {data.rows.length === 0 ? (
          <Empty>{never ? x.projectNever : x.projectEmpty}</Empty>
        ) : (
          <div className="max-h-96 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
                <tr>
                  <th className={TH}>{x.col.domain}</th>
                  <th className={TH}>{x.col.amp}</th>
                  <th className={TH}>{x.col.since}</th>
                  {several && <th className={TH}>{x.col.rotator}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.rows.map(r => (
                  <tr key={`${r.endpoint_id}|${r.domain}`}>
                    <td className={`${TD} break-all font-mono text-xs`}>{r.domain}</td>
                    <td className={`${TD} break-all font-mono text-xs font-semibold`}>{r.amp_domain}</td>
                    <td className={`${TD} whitespace-nowrap text-xs tabular-nums text-slate-600 dark:text-slate-400`}>{shortTime(r.since)}</td>
                    {several && <td className={`${TD} break-all font-mono text-xs text-slate-600 dark:text-slate-400`}>{r.rotator}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
