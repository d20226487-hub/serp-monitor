"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, SerpCsvError, SerpCsvLogEntry, SerpCsvReport, SerpCsvUpload } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button, Callout, Card, Empty, Pill, SectionTitle, TONE_TEXT, TONE_WASH, inputClass } from "@/components/ui";
import { Icon } from "@/components/icons";

/**
 * Upload a SERP export to the project (user, 2026-10-13: "we will use an
 * internal tool to check the SERP, then we will upload a CSV to each
 * project"). Four columns are read — Keywords, GEO, Domain / URL, Position —
 * and the upload becomes a run of the project ("the CSV upload will equal
 * прогон").
 *
 * The file says nothing of the search engine or the device, and the day it
 * is of is only in its name, so those three are asked for here — with
 * defaults, and the day read off the file name when it has one.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The day an export is of, when its name says so: "…_07-10-2026 - Sheet1.csv"
 *  or "…2026-10-07…". Never a day that has not come yet. */
export function dayInName(name: string, today: Date = new Date()): string | null {
  const dmy = name.match(/(?<!\d)(\d{2})[-.](\d{2})[-.](\d{4})(?!\d)/);
  const ymd = name.match(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/);
  const parts = ymd ? [ymd[1], ymd[2], ymd[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : null;
  if (!parts) return null;
  const [y, m, d] = parts.map(Number);
  const day = new Date(y, m - 1, d);
  if (day.getFullYear() !== y || day.getMonth() !== m - 1 || day.getDate() !== d) return null;
  return isoDay(day) <= isoDay(today) ? isoDay(day) : null;
}

const LABEL = "block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400";
const HINT = "text-xs text-slate-500 dark:text-slate-400";

/** What was left out of a file, and why — after a success or a failure. */
function Skipped({ report }: { report: SerpCsvReport }) {
  const { t } = useT();
  const x = t.serpCsv;
  const unknown = Object.entries(report.unknown_geos);
  if (report.empty === 0 && unknown.length === 0 && report.bad_total === 0) return null;
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-sm">
      {report.empty > 0 && <li>{x.skippedEmpty(report.empty)}</li>}
      {unknown.length > 0 && (
        <li>{x.skippedGeo(unknown.map(([name, n]) => `${name} (${n})`).join(", "))}</li>
      )}
      {report.bad_total > 0 && (
        <li>
          {x.skippedBad(report.bad_total)}{" "}
          <span className={HINT}>{report.bad.slice(0, 5).map(b => `${x.line} ${b.line}: ${b.why}`).join("; ")}</span>
        </li>
      )}
    </ul>
  );
}

/**
 * What is left of an upload once the form has closed: one line (user,
 * 2026-10-14: the card left open after an upload "clutters the page"). Rows
 * left out — a country not recognised, a line that could not be read — turn
 * it amber, with the details behind a click; positions listed with nothing on
 * them are normal and only counted.
 */
export function SerpCsvUploadBar({ done, onShowPositions, onDismiss }: {
  done: SerpCsvUpload;
  onShowPositions: () => void;
  onDismiss: () => void;
}) {
  const { t } = useT();
  const x = t.serpCsv;
  const [open, setOpen] = useState(false);
  const notLoaded = Object.values(done.unknown_geos).reduce((sum, n) => sum + n, 0) + done.bad_total;
  const tone = notLoaded > 0 ? "warn" : "good";
  const day = new Date(/[zZ]$/.test(done.checked_at) ? done.checked_at : `${done.checked_at}Z`).toLocaleDateString();
  const facts = [
    Object.entries(done.geos).map(([g, n]) => `${g} ${n}`).join(", "),
    x.barDay(day),
    done.empty > 0 ? x.barEmpty(done.empty) : null,
    done.geos_added.length > 0 ? x.barGeosAdded(done.geos_added.join(", ")) : null,
    done.proxy_checker_after ? x.barProxyChecker : null,
  ].filter(Boolean);
  return (
    <div role="status" className={`rounded-xl border px-3.5 py-2 text-sm ${TONE_WASH[tone]}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Icon name={notLoaded > 0 ? "alert" : "check"} className={`h-4 w-4 shrink-0 ${TONE_TEXT[tone]}`} />
        <span className="font-semibold text-slate-900 dark:text-slate-50">{x.barTitle(done.rows, done.queries)}</span>
        <span className="text-slate-700 dark:text-slate-300">{facts.join(" · ")}</span>
        {notLoaded > 0 && (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            className={`inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline ${TONE_TEXT[tone]}`}
          >
            {x.barNotLoaded(notLoaded)}
            <Icon name="chevronDown" className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} />
          </button>
        )}
        <span className="ml-auto flex items-center gap-3">
          <Button size="sm" onClick={onShowPositions}>{x.showPositions}</Button>
          <Link href={`/runs/${done.run_id}`} className="underline underline-offset-2">{x.barRun(done.run_id)}</Link>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={x.dismiss}
            title={x.dismiss}
            className="rounded p-1 text-slate-500 hover:bg-black/5 dark:text-slate-400 dark:hover:bg-white/10"
          >
            <Icon name="cross" className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {open && notLoaded > 0 && (
        <div className="mt-2 pl-7 text-slate-800 dark:text-slate-200">
          <Skipped report={done} />
        </div>
      )}
    </div>
  );
}

export function SerpCsvUploadCard({ projectId, onUploaded, onClose }: {
  projectId: number;
  /** A run was made: whatever reads the project's runs has to read again, and
   *  the form closes, leaving the result as one line (SerpCsvUploadBar). */
  onUploaded: (done: SerpCsvUpload) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const x = t.serpCsv;
  const today = isoDay(new Date());
  const [file, setFile] = useState<File | null>(null);
  const [engine, setEngine] = useState<"google" | "yandex">("google");
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [day, setDay] = useState(today);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<{ message: string; report?: SerpCsvReport } | null>(null);

  function pick(next: File | null) {
    setFile(next);
    setFail(null);
    // The day the export is of, when its name carries one.
    if (next) setDay(dayInName(next.name) ?? today);
  }

  async function upload() {
    if (!file) return;
    setBusy(true); setFail(null);
    try {
      onUploaded(await api.uploadProjectSerpCsv(projectId, file, { engine, device, checkedOn: day }));
    } catch (e: any) {
      setFail({ message: e?.message ?? "Upload failed", report: e instanceof SerpCsvError ? e.report : undefined });
    } finally { setBusy(false); }
  }

  return (
    <Card
      title={<SectionTitle icon="upload">{x.title}</SectionTitle>}
      actions={<Button size="sm" onClick={onClose}>{t.common.cancel}</Button>}
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{x.help}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1 sm:col-span-2 lg:col-span-1">
            <label className={LABEL}>{x.file}</label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={e => pick(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-800 hover:file:bg-slate-100 dark:file:border-slate-700 dark:file:bg-slate-950 dark:file:text-slate-200 dark:hover:file:bg-slate-800"
            />
          </div>
          <div className="space-y-1">
            <label className={LABEL}>{x.engine}</label>
            <select value={engine} onChange={e => setEngine(e.target.value as "google" | "yandex")} className={inputClass}>
              <option value="google">{t.variantLabel.google}</option>
              <option value="yandex">{t.variantLabel.yandex}</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className={LABEL}>{x.device}</label>
            <select value={device} onChange={e => setDevice(e.target.value as "mobile" | "desktop")} className={inputClass}>
              <option value="mobile">{t.variantLabel.mobile}</option>
              <option value="desktop">{t.variantLabel.desktop}</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className={LABEL}>{x.day}</label>
            <input type="date" value={day} max={today} onChange={e => setDay(e.target.value || today)} className={inputClass} />
          </div>
        </div>
        <p className={HINT}>{x.fieldsHint}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={busy || !file} onClick={upload}>
            <Icon name="upload" className="h-3.5 w-3.5" />
            {busy ? x.uploading : x.upload}
          </Button>
        </div>

        {fail && (
          <Callout tone="bad" icon="alert" title={x.failTitle}>
            <p>{fail.message}</p>
            {fail.report && <Skipped report={fail.report} />}
          </Callout>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* The project's "CSV uploads" tab                                      */
/* ------------------------------------------------------------------ */

/** Server times are UTC without saying so; read as local they are hours off. */
function serverTime(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}

const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400";
const TD = "px-3 py-2 align-top";

/**
 * A short log of the project's CSV uploads, newest first, each removable
 * (user, 2026-10-14: "add the Import CSV log tab as a forth where will be a
 * short log of uploads", with deleting an upload — a wrong file, or the right
 * one dated on the wrong day).
 */
export function ProjectCsvUploadsCard({ projectId, reloadKey = 0, onChanged, onCount }: {
  projectId: number;
  /** Bumped when an upload was made elsewhere on the page. */
  reloadKey?: number;
  /** An upload was removed: whatever reads the project's runs has to read again. */
  onChanged: () => void;
  /** How many uploads there are, for the tab's label. */
  onCount?: (n: number) => void;
}) {
  const { t } = useT();
  const x = t.serpCsv.log;
  const [rows, setRows] = useState<SerpCsvLogEntry[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function take(next: SerpCsvLogEntry[]) {
    setRows(next);
    onCount?.(next.length);
  }
  useEffect(() => {
    api.getProjectSerpCsvUploads(projectId)
      .then(r => { take(r.uploads); setErr(null); })
      .catch(e => setErr(e?.message ?? String(e)));
  }, [projectId, reloadKey]);

  async function remove(u: SerpCsvLogEntry) {
    const day = serverTime(u.checked_at)?.toLocaleDateString() ?? "";
    if (!window.confirm(x.deleteConfirm(u.file_name ?? x.runName(u.run_id), day, u.rows))) return;
    setBusy(u.run_id); setErr(null);
    try {
      take((await api.deleteProjectSerpCsvUpload(projectId, u.run_id)).uploads);
      onChanged();
    } catch (e: any) {
      setErr(e?.message ?? "Delete failed");
    } finally { setBusy(null); }
  }

  const sent = (u: SerpCsvLogEntry) => {
    const s = u.proxy_checker;
    if (!s) return <span className="text-slate-500 dark:text-slate-400">{x.notSent}</span>;
    const tone = s.accepted === s.requests ? "good" : s.accepted > 0 ? "warn" : "bad";
    const title = [
      s.no_answer > 0 ? x.noAnswer(s.no_answer) : null,
      s.refused > 0 ? x.refused(s.refused) : null,
    ].filter(Boolean).join(" · ");
    return <Pill tone={tone} title={title || undefined}>{x.accepted(s.accepted, s.requests)}</Pill>;
  };

  return (
    <Card title={<SectionTitle icon="upload" count={rows?.length}>{x.title}</SectionTitle>}>
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{x.help}</p>
        {err && <Callout tone="bad" icon="alert">{err}</Callout>}
        {rows && rows.length === 0 && <Empty>{x.empty}</Empty>}
        {rows && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50">
                <tr>
                  <th className={TH}>{x.col.uploaded}</th>
                  <th className={TH}>{x.col.file}</th>
                  <th className={TH}>{x.col.day}</th>
                  <th className={TH}>{x.col.serp}</th>
                  <th className={`${TH} text-right`}>{x.col.rows}</th>
                  <th className={TH}>{x.col.geos}</th>
                  <th className={TH}>{x.col.skipped}</th>
                  <th className={TH}>Proxy Checker</th>
                  <th className={TH}><span className="sr-only">{x.col.actions}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {rows.map(u => (
                  <tr key={u.run_id}>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>
                      {serverTime(u.uploaded_at)?.toLocaleString(undefined, {
                        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
                      }) ?? "—"}
                    </td>
                    <td className={`${TD} break-all font-mono text-xs`}>
                      {u.file_name ?? <span className="font-sans text-slate-400 dark:text-slate-500" title={x.notKept}>—</span>}
                    </td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>{serverTime(u.checked_at)?.toLocaleDateString()}</td>
                    <td className={`${TD} whitespace-nowrap`}>
                      {[
                        u.engine === "yandex" ? t.variantLabel.yandex : u.engine ? t.variantLabel.google : null,
                        u.device === "desktop" ? t.variantLabel.desktop : u.device ? t.variantLabel.mobile : null,
                      ].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className={`${TD} whitespace-nowrap text-right tabular-nums`}>{x.rowsQueries(u.rows, u.queries)}</td>
                    <td className={TD}>
                      {Object.entries(u.geos).map(([g, n]) => `${g} ${n}`).join(", ")}
                      {u.geos_added && u.geos_added.length > 0 && (
                        <div className="text-xs text-slate-500 dark:text-slate-400">{x.geosAdded(u.geos_added.join(", "))}</div>
                      )}
                    </td>
                    <td className={TD}>
                      {u.empty === null ? (
                        <span className="text-slate-400 dark:text-slate-500" title={x.notKept}>—</span>
                      ) : (
                        <div className="space-y-0.5 text-xs">
                          {u.empty > 0 && <div>{x.empty_(u.empty)}</div>}
                          {(u.not_loaded ?? 0) > 0 && (
                            <div
                              className="text-amber-700 dark:text-amber-400"
                              title={[
                                Object.entries(u.unknown_geos ?? {}).map(([g, n]) => `${g} (${n})`).join(", "),
                                (u.bad_total ?? 0) > 0 ? x.bad(u.bad_total ?? 0) : "",
                              ].filter(Boolean).join(" · ")}
                            >
                              {x.notLoaded(u.not_loaded ?? 0)}
                            </div>
                          )}
                          {u.empty === 0 && (u.not_loaded ?? 0) === 0 && <span className="text-slate-500 dark:text-slate-400">{x.none}</span>}
                        </div>
                      )}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{sent(u)}</td>
                    <td className={`${TD} whitespace-nowrap text-right`}>
                      <span className="inline-flex items-center gap-3">
                        <Link href={`/runs/${u.run_id}`} className="text-xs underline underline-offset-2">{x.runName(u.run_id)}</Link>
                        <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => remove(u)}>
                          <Icon name="trash" className="h-3.5 w-3.5" />
                          {busy === u.run_id ? x.deleting : x.delete}
                        </Button>
                      </span>
                    </td>
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
