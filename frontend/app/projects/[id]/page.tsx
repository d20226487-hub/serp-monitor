"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, Job, Project, ProjectPositions } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { PositionTable } from "@/components/position-table";
import {
  RANGE_PRESETS, RangePreset, customRange, rangeFor, toInputValue, toQuery,
} from "@/lib/date-range";

/**
 * One project, led by where its domains rank.
 *
 * Positions come first and everything else is context underneath, because the
 * question someone opens a project to answer is "where are we today" — not
 * "which jobs exist". The jobs and keywords below are what explains the table:
 * which schedules feed it and which terms it can possibly cover.
 */
export default function ProjectPage() {
  const { t } = useT();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const [project, setProject] = useState<Project | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [positions, setPositions] = useState<ProjectPositions | null>(null);
  const [preset, setPreset] = useState<RangePreset>("today");
  const [from, setFrom] = useState(() => toInputValue(new Date()));
  const [to, setTo] = useState(() => toInputValue(new Date()));
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // null while a custom range is half-typed, which is the signal not to query.
  const range = useMemo(
    () => (preset === "custom" ? customRange(from, to) : rangeFor(preset)),
    [preset, from, to],
  );

  const loadPositions = useCallback(async () => {
    if (!range) return;
    setLoading(true);
    try {
      setPositions(await api.projectPositions(id, toQuery(range)));
      setErr(null);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [id, range]);

  useEffect(() => { loadPositions(); }, [loadPositions]);

  useEffect(() => {
    api.getProject(id).then(setProject).catch(e => setErr(e?.message ?? String(e)));
    // limit covers every job a project realistically holds; the jobs list page
    // is the place for paging through hundreds.
    api.listJobs({ projectId: id, limit: 200 }).then(p => setJobs(p.items)).catch(() => {});
  }, [id]);

  // Every keyword the project's jobs watch, deduplicated case-insensitively —
  // the same term entered in two jobs is one thing being tracked, not two.
  const keywords = useMemo(() => {
    const seen = new Map<string, string>();
    for (const j of jobs) {
      for (const k of j.keywords) {
        const key = k.trim().toLowerCase();
        if (key && !seen.has(key)) seen.set(key, k.trim());
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [jobs]);

  const scheduled = jobs.filter(j => j.schedule_enabled && j.cron);

  if (!project && err) {
    return <div className="text-sm text-red-600 dark:text-red-400">{err}</div>;
  }
  if (!project) {
    return <div className="text-sm text-neutral-600 dark:text-neutral-400">{t.common.loading}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        <span className="text-xs text-neutral-600 dark:text-neutral-400">
          {t.projects.domainsCount(project.domains.length)} · {t.projects.jobsCount(jobs.length)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={`/jobs/new?project=${project.id}`}
            className="px-3 py-1.5 rounded-md border dark:border-neutral-700 text-sm"
          >
            {t.projects.newJob}
          </Link>
          <Link
            href="/projects"
            className="px-3 py-1.5 rounded-md border dark:border-neutral-700 text-sm"
          >
            {t.positions.allProjects}
          </Link>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{t.positions.title}</h2>
          <div className="inline-flex rounded-md border dark:border-neutral-700 overflow-hidden">
            {RANGE_PRESETS.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPreset(p)}
                aria-pressed={preset === p}
                className={`px-2 py-1 text-xs border-l first:border-l-0 dark:border-neutral-700 ${
                  preset === p
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`}
              >
                {t.positions.presets[p]}
              </button>
            ))}
          </div>
          {preset === "custom" && (
            <span className="inline-flex items-center gap-1.5 text-xs">
              <input
                type="date"
                value={from}
                onChange={e => setFrom(e.target.value)}
                className="px-2 py-1 rounded border bg-white dark:bg-neutral-900 dark:border-neutral-700"
              />
              <span className="text-neutral-600 dark:text-neutral-400">–</span>
              <input
                type="date"
                value={to}
                onChange={e => setTo(e.target.value)}
                className="px-2 py-1 rounded border bg-white dark:bg-neutral-900 dark:border-neutral-700"
              />
            </span>
          )}
          {positions && positions.runs.length > 0 && (
            <span className="text-xs text-neutral-600 dark:text-neutral-400">
              {t.positions.fromRuns(positions.runs.length, positions.rows.length)}
            </span>
          )}
          {loading && (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">{t.common.loading}</span>
          )}
        </div>

        {preset === "custom" && !range && (
          <div className="text-xs text-amber-700 dark:text-amber-300">{t.positions.badRange}</div>
        )}
        {err && <div className="text-sm text-red-600 dark:text-red-400">{err}</div>}
        {positions && <PositionTable data={positions} />}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t.positions.scheduled}</h2>
        {scheduled.length === 0 ? (
          <div className="text-sm text-neutral-600 dark:text-neutral-400 border rounded-md p-4 dark:border-neutral-700">
            {t.positions.noScheduled}
          </div>
        ) : (
          <div className="space-y-2">
            {scheduled.map(j => (
              <div key={j.id} className="border rounded-md px-4 py-2.5 flex items-center gap-3 dark:border-neutral-700">
                <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">{j.name}</Link>
                <span className="text-xs text-neutral-600 dark:text-neutral-400">
                  ⏱ {j.cron} · {t.home.kwCount(j.keywords.length)} · {j.engines.join(", ")} · {j.devices.join(", ")}
                </span>
              </div>
            ))}
          </div>
        )}
        {/* Jobs without a schedule still feed the table when run by hand, so
            they are worth naming rather than leaving invisible. */}
        {jobs.length > scheduled.length && (
          <div className="text-xs text-neutral-600 dark:text-neutral-400">
            {t.positions.manualJobs(jobs.length - scheduled.length)}{" "}
            <Link href={`/?project=${project.id}`} className="underline">
              {t.projects.viewJobs}
            </Link>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">
          {t.positions.keywords}{" "}
          <span className="text-sm font-normal text-neutral-600 dark:text-neutral-400">
            {t.home.kwCount(keywords.length)}
          </span>
        </h2>
        {keywords.length === 0 ? (
          <div className="text-sm text-neutral-600 dark:text-neutral-400 border rounded-md p-4 dark:border-neutral-700">
            {t.positions.noKeywords}
          </div>
        ) : (
          <div className="border rounded-md p-3 dark:border-neutral-700 flex flex-wrap gap-1.5">
            {keywords.map(k => (
              <span
                key={k}
                className="px-2 py-0.5 rounded-full border text-xs dark:border-neutral-700 text-neutral-700 dark:text-neutral-300"
              >
                {k}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t.projects.domains}</h2>
        <div className="border rounded-md p-3 dark:border-neutral-700 flex flex-wrap gap-1.5">
          {project.domains.map(d => (
            <span key={d} className="px-2 py-0.5 rounded-full border text-xs font-mono dark:border-neutral-700">
              {d}
            </span>
          ))}
          {project.domains.length === 0 && (
            <span className="text-sm text-neutral-600 dark:text-neutral-400">{t.positions.noDomains}</span>
          )}
        </div>
      </section>
    </div>
  );
}
