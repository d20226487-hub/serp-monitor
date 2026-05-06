"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Job } from "@/lib/api";
import { useT } from "@/lib/i18n";

export default function HomePage() {
  const { t } = useT();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try { setJobs(await api.listJobs()); }
    catch (e: any) { setErr(e.message); }
  }

  useEffect(() => { load(); }, []);

  async function rename(j: Job) {
    const next = prompt(t.home.renamePrompt, j.name);
    if (!next || next === j.name) return;
    await api.updateJob(j.id, { name: next });
    load();
  }
  async function del(j: Job) {
    if (!confirm(t.home.deleteConfirm(j.name))) return;
    await api.deleteJob(j.id);
    load();
  }
  async function runNow(j: Job) {
    const run = await api.runJob(j.id);
    location.href = `/jobs/${j.id}#run-${run.id}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t.home.title}</h1>
        <Link
          href="/jobs/new"
          className="px-3 py-1.5 rounded-md bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-sm"
        >
          {t.home.newJob}
        </Link>
      </div>
      {err && <div className="text-red-600 dark:text-red-400 text-sm">{err}</div>}

      {jobs.length === 0 && (
        <div className="text-neutral-500 text-sm border rounded-md p-6 dark:border-neutral-700">
          {t.home.empty}
        </div>
      )}

      <div className="space-y-2">
        {jobs.map(j => (
          <div key={j.id} className="border rounded-md px-4 py-3 flex items-center gap-4 dark:border-neutral-700">
            <div className="flex-1 min-w-0">
              <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">{j.name}</Link>
              <div className="text-xs text-neutral-500 truncate">
                {j.provider || "serpapi"} ·
                {" "}{t.home.kwCount(j.keywords.length)} · {j.engines.join(", ") || "—"} ·
                {" "}{j.devices.join(", ") || "—"} ·
                {" "}{t.home.locCount(j.locations.length)} ·
                {" "}{t.home.langCount(j.languages.length)}
                {j.schedule_enabled && j.cron && <> · ⏱ {j.cron}</>}
              </div>
            </div>
            <button onClick={() => runNow(j)} className="text-sm px-2 py-1 rounded border dark:border-neutral-700">{t.home.run}</button>
            <Link href={`/jobs/${j.id}`} className="text-sm px-2 py-1 rounded border dark:border-neutral-700">{t.common.open}</Link>
            <button onClick={() => rename(j)} className="text-sm px-2 py-1 rounded border dark:border-neutral-700">{t.common.rename}</button>
            <button onClick={() => del(j)} className="text-sm px-2 py-1 rounded border dark:border-neutral-700 text-red-600 dark:text-red-400">{t.common.delete}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
