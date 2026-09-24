"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, Job, Project } from "@/lib/api";
import { useT } from "@/lib/i18n";

const PAGE_SIZE = 25;

/**
 * The jobs list: searchable, paginated, and grouped into project folders.
 *
 * Searching and paging are done by the SERVER, not by filtering an array here.
 * A job carries its keywords, and a hundred jobs of a thousand keywords each is
 * megabytes to ship and re-ship on every keystroke; the filter also has to see
 * jobs that are not on the current page or it would only ever search what
 * happened to be loaded.
 *
 * The folder a job sits in is its project. Nothing creates or stores a folder:
 * the grouping is derived from `project_id`, so a project's folder appears when
 * the first job points at it and is gone when the last one stops.
 */
export default function HomePage() {
  const { t } = useT();
  // The project filter lives in the URL, and useSearchParams opts the route
  // out of prerendering unless a boundary catches it.
  return (
    <Suspense fallback={<div className="text-sm text-neutral-600 dark:text-neutral-400">{t.common.loading}</div>}>
      <JobsList />
    </Suspense>
  );
}

function JobsList() {
  const { t } = useT();
  const router = useRouter();
  const params = useSearchParams();

  // The project filter lives in the URL so "view jobs" from the projects page
  // lands somewhere linkable and the back button behaves.
  const projectParam = params.get("project");
  const projectFilter = projectParam ? Number(projectParam) : null;

  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  // Debounced copy of `query`: the input stays responsive while the server is
  // asked at most once per pause in typing.
  const [search, setSearch] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(query);
      setOffset(0);  // a new search starts at the first page, not page four
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await api.listJobs({
        q: search,
        projectId: projectFilter,
        limit: PAGE_SIZE,
        offset,
      });
      setJobs(page.items);
      setTotal(page.total);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [search, projectFilter, offset]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    // Folder names for the group headings, and the filter dropdown.
    api.listProjects().then(setProjects).catch(() => {});
  }, []);

  const byId = new Map(projects.map(p => [p.id, p]));
  // Folders in the order their jobs come back, so the most recently edited
  // project leads — the same ordering the flat list would have had.
  //
  // `key` is the job's project_id and is what React keys the group on. It must
  // not be taken from the resolved `project`, which is null both for a job in
  // no project AND for a job whose project has not arrived yet: the projects
  // list is fetched separately and lands a paint later, so on the first render
  // EVERY group resolved to null and they all shared one key. React cannot
  // tell same-key siblings apart, and when the ids later changed it stranded
  // the old subtree instead of removing it — one job rendered twice, in a
  // group with no heading, and re-rendering never cleared it.
  type Group = { key: number | null; project: Project | null; jobs: Job[] };
  const groups: Group[] = [];
  const seen = new Map<number | null, number>();
  for (const j of jobs) {
    const key = j.project_id ?? null;
    let idx = seen.get(key);
    if (idx === undefined) {
      idx = groups.length;
      seen.set(key, idx);
      groups.push({ key, project: key == null ? null : byId.get(key) ?? null, jobs: [] });
    }
    groups[idx].jobs.push(j);
  }

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

  function setProjectFilter(value: string) {
    router.push(value ? `/?project=${value}` : "/");
    setOffset(0);
  }

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

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

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t.home.searchPlaceholder}
          className="flex-1 min-w-[16rem] px-3 py-2 rounded-md border bg-white dark:bg-neutral-900 dark:border-neutral-700 text-sm"
        />
        <select
          value={projectFilter ?? ""}
          onChange={e => setProjectFilter(e.target.value)}
          className="px-3 py-2 rounded-md border bg-white dark:bg-neutral-900 dark:border-neutral-700 text-sm"
        >
          <option value="">{t.home.allProjects}</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {err && <div className="text-red-600 dark:text-red-400 text-sm">{err}</div>}

      {!loading && total === 0 ? (
        <div className="text-neutral-600 dark:text-neutral-400 text-sm border rounded-md p-6 dark:border-neutral-700">
          {search || projectFilter != null ? t.home.noMatches : t.home.empty}
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(g => (
            <div key={g.key ?? "none"} className="space-y-2">
              {/* Three cases, and only two of them get a heading. A resolved
                  project is named. A job in no project is called out as such,
                  but only once some project exists — a list that is entirely
                  ungrouped should not grow a "no project" header over every
                  row. A group whose project has not loaded yet gets nothing
                  rather than being mislabelled "no project" for a paint. */}
              {g.project ? (
                <div className="flex items-baseline gap-2 text-sm">
                  <Link href={`/projects/${g.project.id}`} className="font-medium hover:underline">
                    {g.project.name}
                  </Link>
                  <span className="text-xs text-neutral-600 dark:text-neutral-400">
                    {t.projects.domainsCount(g.project.domains.length)}
                  </span>
                </div>
              ) : g.key == null && projects.length > 0 ? (
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="text-neutral-600 dark:text-neutral-400">
                    {t.home.ungrouped}
                  </span>
                </div>
              ) : null}
              {g.jobs.map(j => (
                <div key={j.id} className="border rounded-md px-4 py-3 flex items-center gap-4 dark:border-neutral-700">
                  <div className="flex-1 min-w-0">
                    <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">{j.name}</Link>
                    <div className="text-xs text-neutral-600 dark:text-neutral-400 truncate">
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
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center gap-3 text-sm">
          <button
            onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}
            disabled={offset === 0}
            className="px-2 py-1 rounded border dark:border-neutral-700 disabled:opacity-40"
          >
            {t.home.prev}
          </button>
          <span className="text-neutral-600 dark:text-neutral-400">
            {t.home.showing(from, to, total)}
          </span>
          <button
            onClick={() => setOffset(o => o + PAGE_SIZE)}
            disabled={to >= total}
            className="px-2 py-1 rounded border dark:border-neutral-700 disabled:opacity-40"
          >
            {t.home.next}
          </button>
        </div>
      )}
    </div>
  );
}
