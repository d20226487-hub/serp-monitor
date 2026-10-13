"use client";
import { useState } from "react";
import Link from "next/link";
import { api, SerpCsvError, SerpCsvReport, SerpCsvUpload } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button, Callout, Card, SectionTitle, inputClass } from "@/components/ui";
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

export function SerpCsvUploadCard({ projectId, onUploaded, onClose, onShowPositions }: {
  projectId: number;
  /** A run was made: whatever reads the project's runs has to read again. */
  onUploaded: () => void;
  onClose: () => void;
  onShowPositions: () => void;
}) {
  const { t } = useT();
  const x = t.serpCsv;
  const today = isoDay(new Date());
  const [file, setFile] = useState<File | null>(null);
  const [engine, setEngine] = useState<"google" | "yandex">("google");
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [day, setDay] = useState(today);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SerpCsvUpload | null>(null);
  const [fail, setFail] = useState<{ message: string; report?: SerpCsvReport } | null>(null);

  function pick(next: File | null) {
    setFile(next);
    setDone(null);
    setFail(null);
    // The day the export is of, when its name carries one.
    if (next) setDay(dayInName(next.name) ?? today);
  }

  async function upload() {
    if (!file) return;
    setBusy(true); setDone(null); setFail(null);
    try {
      setDone(await api.uploadProjectSerpCsv(projectId, file, { engine, device, checkedOn: day }));
      onUploaded();
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

        {done && (
          <Callout tone="good" icon="check" title={x.doneTitle(done.rows, done.queries)}>
            <p>
              {x.doneGeos(Object.entries(done.geos).map(([g, n]) => `${g} ${n}`).join(", "))}{" "}
              {x.doneDay(new Date(/[zZ]$/.test(done.checked_at) ? done.checked_at : `${done.checked_at}Z`).toLocaleDateString())}
            </p>
            {done.geos_added.length > 0 && <p>{x.doneGeosAdded(done.geos_added.join(", "))}</p>}
            {done.proxy_checker_after && <p>{x.doneProxyChecker}</p>}
            <Skipped report={done} />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="sm" onClick={onShowPositions}>{x.showPositions}</Button>
              <Link href={`/runs/${done.run_id}`} className="text-sm underline underline-offset-2">{x.openRun(done.run_id)}</Link>
            </div>
          </Callout>
        )}
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
