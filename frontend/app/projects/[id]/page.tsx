"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, Job, Project, ProjectPositions } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { PositionTable } from "@/components/position-table";
import { Button, Card, Empty, ErrorNote, SectionTitle, StatTile } from "@/components/ui";
import { Icon } from "@/components/icons";
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
/** The names behind a count, small and wrapped. Capped because a project can
 *  watch more cities than a tile can show without becoming the wall of text
 *  this row replaced. */
function ChipList({ items, max = 4 }: { items: string[]; max?: number }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, max);
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {shown.map(v => (
        <span
          key={v}
          className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          {v}
        </span>
      ))}
      {items.length > max && (
        <span className="px-1 py-0.5 text-[11px] text-slate-500 dark:text-slate-400">
          +{items.length - max}
        </span>
      )}
    </div>
  );
}

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

  // What the project actually watches, read off its jobs rather than stored:
  // the jobs are the only thing that decides where and on what a keyword is
  // measured, so a derived list cannot drift from them.
  const geos = useMemo(() => {
    const seen = new Map<string, string>();
    for (const j of jobs) {
      for (const l of j.locations) {
        const name = (l.name || l.canonical_name || "").split(",")[0].trim();
        const key = name.toLowerCase();
        if (name && !seen.has(key)) seen.set(key, name);
      }
      // A job with no location still runs, just without geo targeting.
      if (j.locations.length === 0) seen.set("__none", t.positions.noGeo);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [jobs, t]);

  const engines = useMemo(() => {
    const seen = new Set<string>();
    for (const j of jobs) for (const e of j.engines) seen.add(e);
    return [...seen].sort();
  }, [jobs]);

  if (!project && err) return <ErrorNote>{err}</ErrorNote>;
  if (!project) {
    return <div className="text-sm text-slate-600 dark:text-slate-400">{t.common.loading}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
          <Icon name="layers" className="h-4 w-4" />
        </span>
        <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
        <div className="ml-auto flex items-center gap-1.5">
          <Link
            href={`/jobs/new?project=${project.id}`}
            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
            {t.projects.newJob}
          </Link>
          <Link
            href="/projects"
            className="rounded-lg border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            {t.positions.allProjects}
          </Link>
        </div>
      </div>

      {/* What the project is, in one row. The domains themselves are not here
          on purpose: a project built from permutations runs to hundreds of
          near-identical hosts, and listing them buried the positions this page
          exists for. The count is the useful part; the list lives in the
          project's own edit form. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label={t.projects.domains} value={project.domains.length} icon="globe" />
        <StatTile label={t.positions.keywords} value={keywords.length} icon="keywords" />
        <StatTile label={t.projects.viewJobs} value={jobs.length} icon="list" />
        <StatTile label={t.positions.geos} value={geos.length} icon="flag">
          <ChipList items={geos} />
        </StatTile>
        <StatTile label={t.positions.engines} value={engines.length} icon="search">
          <ChipList
            items={engines.map(e => (e === "yandex" ? t.variantLabel.yandex : t.variantLabel.google))}
          />
        </StatTile>
      </div>

      <section className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <SectionTitle icon="activity">{t.positions.title}</SectionTitle>
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
            {RANGE_PRESETS.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPreset(p)}
                aria-pressed={preset === p}
                className={`border-l px-2.5 py-1 text-xs transition first:border-l-0 dark:border-slate-700 ${
                  preset === p
                    ? "bg-slate-900 font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
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
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <span className="text-slate-500 dark:text-slate-400">–</span>
              <input
                type="date"
                value={to}
                onChange={e => setTo(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </span>
          )}
          {positions && positions.runs.length > 0 && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t.positions.fromRuns(
                positions.runs.length,
                positions.serps.reduce((n, s) => n + s.rows.length, 0),
                positions.serps.length,
              )}
            </span>
          )}
          {loading && (
            <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Icon name="refresh" className="h-3 w-3 animate-spin" />
              {t.common.loading}
            </span>
          )}
        </div>

        {preset === "custom" && !range && (
          <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {t.positions.badRange}
          </div>
        )}
        {err && <ErrorNote>{err}</ErrorNote>}
        {positions && <PositionTable data={positions} />}
      </section>

      <section className="space-y-2">
        <SectionTitle icon="clock" count={scheduled.length}>{t.positions.scheduled}</SectionTitle>
        {scheduled.length === 0 ? (
          <Empty>{t.positions.noScheduled}</Empty>
        ) : (
          <div className="space-y-2">
            {scheduled.map(j => (
              <div
                key={j.id}
                className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <Link href={`/jobs/${j.id}`} className="font-medium tracking-tight hover:underline">
                  {j.name}
                </Link>
                <span className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-1.5 py-0.5 font-mono text-[11px] text-sky-800 dark:bg-sky-950 dark:text-sky-300">
                  <Icon name="clock" className="h-3 w-3" />
                  {j.cron}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {t.home.kwCount(j.keywords.length)} · {j.engines.join(", ")} · {j.devices.join(", ")}
                </span>
              </div>
            ))}
          </div>
        )}
        {/* Jobs without a schedule still feed the table when run by hand, so
            they are worth naming rather than leaving invisible. */}
        {jobs.length > scheduled.length && (
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {t.positions.manualJobs(jobs.length - scheduled.length)}{" "}
            <Link href={`/?project=${project.id}`} className="underline">
              {t.projects.viewJobs}
            </Link>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <SectionTitle icon="keywords" count={keywords.length}>{t.positions.keywords}</SectionTitle>
        {keywords.length === 0 ? (
          <Empty>{t.positions.noKeywords}</Empty>
        ) : (
          <div className="flex min-w-0 flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {keywords.map(k => (
              <span
                key={k}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                {k}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
