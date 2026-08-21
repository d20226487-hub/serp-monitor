"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, Job, JobRun, ScheduleInfo } from "@/lib/api";
import { JobForm } from "@/components/job-form";
import { useT } from "@/lib/i18n";
import { formatUsd, sumCost, hasAnyCost } from "@/lib/cost";

export default function JobPage() {
  const { t } = useT();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [job, setJob] = useState<Job | null>(null);
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [edit, setEdit] = useState(false);
  const [schedInfo, setSchedInfo] = useState<ScheduleInfo | null>(null);

  async function load() {
    setJob(await api.getJob(id));
    setRuns(await api.listRuns(id));
    try { setSchedInfo(await api.getScheduleInfo(id)); }
    catch { setSchedInfo(null); }
  }

  useEffect(() => { load(); }, [id]);

  // Poll while a run is in progress
  useEffect(() => {
    const live = runs.some(r => r.status === "running" || r.status === "pending");
    if (!live) return;
    const t2 = setInterval(() => api.listRuns(id).then(setRuns), 3000);
    return () => clearInterval(t2);
  }, [runs, id]);

  if (!job) return <div className="text-sm text-neutral-600 dark:text-neutral-400">{t.common.loading}</div>;

  if (edit) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{t.jobs.editPrefix(job.name)}</h1>
          <button className="text-sm px-3 py-1 border rounded dark:border-neutral-700"
                  onClick={() => setEdit(false)}>{t.common.cancel}</button>
        </div>
        <JobForm
          initial={job}
          onSaved={async (updated, { ranAfter }) => {
            setJob(updated);
            setEdit(false);
            // Refresh runs in case "Save & run now" added one.
            if (ranAfter) setRuns(await api.listRuns(id));
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold flex-1 min-w-0">{job.name}</h1>
        <button
          onClick={async () => { const r = await api.runJob(id); setRuns([r, ...runs]); }}
          className="px-3 py-1.5 rounded-md bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-sm"
        >{t.jobs.runNow}</button>
        <button onClick={() => setEdit(true)} className="px-3 py-1.5 rounded-md border dark:border-neutral-700 text-sm">{t.common.edit}</button>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <Field label={t.jobs.fields.provider} value={job.provider || "serpapi"} />
        <Field label={t.jobs.fields.keywords} value={t.jobs.keywordsCount(job.keywords.length)} />
        <Field label={t.jobs.fields.engines} value={job.engines.join(", ") || "—"} />
        <Field label={t.jobs.fields.devices} value={job.devices.join(", ") || "—"} />
        <Field label={t.jobs.fields.languages} value={job.languages.join(", ") || "—"} />
        <Field label={t.jobs.fields.locations} value={job.locations.map(l => l.canonical_name).join(" • ") || "—"} />
        <Field label={t.jobs.fields.googleDomains} value={job.google_domains.join(", ") || t.jobs.autoFallback} />
        <Field label={t.jobs.fields.topN} value={String(job.top_n)} />
        <ScheduleField job={job} info={schedInfo} />
      </div>

      <div className="flex flex-wrap items-baseline gap-3 pt-4">
        <h2 className="text-lg font-semibold">{t.jobs.runs}</h2>
        {/* Lifetime spend across every run of this job. Hidden entirely when no
            run has a recorded cost, so legacy runs don't read as "$0 spent". */}
        {hasAnyCost(runs) && (
          <span className="text-sm text-neutral-600 dark:text-neutral-400">
            {t.jobs.totalCost(formatUsd(sumCost(runs)), runs.filter(r => r.cost != null).length)}
          </span>
        )}
      </div>
      <div className="space-y-2">
        {runs.length === 0 && <div className="text-sm text-neutral-600 dark:text-neutral-400">{t.jobs.noRuns}</div>}
        {runs.map(r => (
          <div key={r.id} id={`run-${r.id}`}
               className="border rounded-md px-4 py-3 flex flex-wrap items-center gap-3 dark:border-neutral-700">
            <StatusBadge status={r.status} />
            <Link href={`/runs/${r.id}`} className="font-medium hover:underline">{t.jobs.runEntry.runLabel(r.id)}</Link>
            <div className="text-xs text-neutral-600 dark:text-neutral-400 flex-1 min-w-0 truncate">
              {new Date(r.started_at).toLocaleString()} ·
              {" "}{t.jobs.runEntry.progress(r.queries_done, r.queries_total)}
              {r.queries_failed > 0 && <span className="text-red-600 dark:text-red-400"> · {t.jobs.runEntry.failed(r.queries_failed)}</span>}
              {" · "}{r.triggered_by}
              {r.cost != null && (
                <span title={r.cost_source === "actual" ? t.cost.actualHint : t.cost.estimateHint}>
                  {" · "}{formatUsd(r.cost)}
                  {r.cost_source === "estimate" && <span className="text-neutral-500 dark:text-neutral-400">*</span>}
                </span>
              )}
            </div>
            <Link href={`/runs/${r.id}`} className="text-sm px-2 py-1 rounded border dark:border-neutral-700">{t.common.open}</Link>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-md px-3 py-2 dark:border-neutral-700">
      <div className="text-xs text-neutral-600 dark:text-neutral-400">{label}</div>
      <div>{value}</div>
    </div>
  );
}

function ScheduleField({ job, info }: { job: Job; info: ScheduleInfo | null }) {
  const { t } = useT();
  if (!job.cron) {
    return <Field label={t.jobs.fields.schedule} value="—" />;
  }
  const enabled = job.schedule_enabled;
  const nextLocal = info?.next_run_time
    ? new Date(info.next_run_time).toLocaleString()
    : null;
  return (
    <div className="border rounded-md px-3 py-2 dark:border-neutral-700">
      <div className="text-xs text-neutral-600 dark:text-neutral-400">{t.jobs.fields.schedule}</div>
      <div className="font-mono">{job.cron}</div>
      <div className="text-xs mt-0.5">
        {enabled
          ? <span className="text-emerald-700 dark:text-emerald-300">{t.jobs.schedule.enabled}</span>
          : <span className="text-neutral-600 dark:text-neutral-400">{t.jobs.schedule.disabled}</span>}
        {info?.timezone && <> · {t.jobs.schedule.cronInTz(info.timezone)}</>}
      </div>
      {enabled && (
        <div className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">
          {info?.registered === false && (
            <span className="text-amber-700 dark:text-amber-300">
              {t.jobs.schedule.notRegistered}
            </span>
          )}
          {nextLocal && t.jobs.schedule.nextRun(nextLocal)}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useT();
  const cls: Record<string, string> = {
    pending: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
    running: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
    done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    failed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
    canceled: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
  };
  const labels = t.jobs.statusBadge as Record<string, string>;
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs ${cls[status] ||""}`}>
      {labels[status] ?? status}
    </span>
  );
}
