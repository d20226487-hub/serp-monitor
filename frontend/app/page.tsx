"use client";
import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, Job, Project } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button, Empty, ErrorNote, inputClass } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";

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
/** One fact about a job. An icon and a word beat a dot-separated run-on line:
 *  the eye can find the provider or the schedule without reading the whole
 *  string. */
function Chip({
  icon, children, tone = "neutral",
}: {
  icon: IconName;
  children: ReactNode;
  tone?: "neutral" | "info";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ${
        tone === "info"
          ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
      }`}
    >
      <Icon name={icon} className="h-3 w-3" />
      {children}
    </span>
  );
}

export default function HomePage() {
  const { t } = useT();
  // The project filter lives in the URL, and useSearchParams opts the route
  // out of prerendering unless a boundary catches it.
  return (
    <Suspense fallback={<div className="text-sm text-slate-600 dark:text-slate-400">{t.common.loading}</div>}>
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
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t.home.title}</h1>
        {total > 0 && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t.home.showing(from, to, total)}
          </span>
        )}
      </div>

      {/* A toolbar, not a Card: cards are for report sections, and wrapping a
          single input in one adds a box and a heading that only repeat the
          placeholder. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Icon
            name="search"
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
          />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t.home.searchPlaceholder}
            aria-label={t.home.searchPlaceholder}
            className={`${inputClass} pl-9`}
          />
        </div>
        <select
          value={projectFilter ?? ""}
          onChange={e => setProjectFilter(e.target.value)}
          aria-label={t.home.allProjects}
          /* Explicit background: a transparent select draws an unreadable
             native option list in the dark theme. */
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        >
          <option value="">{t.home.allProjects}</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {err && <ErrorNote>{err}</ErrorNote>}

      {!loading && total === 0 ? (
        <Empty>{search || projectFilter != null ? t.home.noMatches : t.home.empty}</Empty>
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
                  <span className="grid h-5 w-5 shrink-0 place-items-center self-center rounded-md bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                    <Icon name="layers" className="h-3 w-3" />
                  </span>
                  <Link
                    href={`/projects/${g.project.id}`}
                    className="font-semibold tracking-tight hover:underline"
                  >
                    {g.project.name}
                  </Link>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {t.projects.domainsCount(g.project.domains.length)}
                  </span>
                </div>
              ) : g.key == null && projects.length > 0 ? (
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  {t.home.ungrouped}
                </div>
              ) : null}
              {g.jobs.map(j => (
                <div
                  key={j.id}
                  className="group flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/jobs/${j.id}`}
                      className="font-medium tracking-tight hover:underline"
                    >
                      {j.name}
                    </Link>
                    {/* The facts that distinguish one job from another, as
                        chips rather than a dot-separated run-on line. */}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <Chip icon="robot">{j.provider || "serpapi"}</Chip>
                      <Chip icon="keywords">{t.home.kwCount(j.keywords.length)}</Chip>
                      <Chip icon="globe">{j.engines.join(", ") || "—"}</Chip>
                      <Chip icon={j.devices.includes("mobile") ? "phone" : "desktop"}>
                        {j.devices.join(", ") || "—"}
                      </Chip>
                      <Chip icon="flag">{t.home.locCount(j.locations.length)}</Chip>
                      {j.schedule_enabled && j.cron && (
                        <Chip icon="clock" tone="info">{j.cron}</Chip>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button size="sm" onClick={() => runNow(j)}>
                      <Icon name="play" className="h-3 w-3" />
                      {t.home.run}
                    </Button>
                    <Link
                      href={`/jobs/${j.id}`}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                    >
                      {t.common.open}
                    </Link>
                    <Button size="sm" onClick={() => rename(j)}>{t.common.rename}</Button>
                    <Button size="sm" variant="danger" onClick={() => del(j)}>
                      {t.common.delete}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button
            size="sm"
            onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}
            disabled={offset === 0}
          >
            {t.home.prev}
          </Button>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t.home.showing(from, to, total)}
          </span>
          <Button size="sm" onClick={() => setOffset(o => o + PAGE_SIZE)} disabled={to >= total}>
            {t.home.next}
          </Button>
        </div>
      )}
    </div>
  );
}
