"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, Job, Project, ProjectAverages, ProjectPositions } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { AveragePositionTable, PositionTable } from "@/components/position-table";
import { ProjectProxyCheckerCard } from "@/components/proxy-checker";
import { ProjectBlocksCard, ProjectNotPassingCard } from "@/components/project-blocks";
import { ProjectAmpCard } from "@/components/amp-rotator";
import { ProjectCsvUploadsCard, SerpCsvUploadBar, SerpCsvUploadCard } from "@/components/serp-csv-upload";
import { ProjectKeywordsCard } from "@/components/project-keywords";
import type { SerpCsvUpload } from "@/lib/api";
import { ProjectGeosCard } from "@/components/project-geos";
import { Button, Card, Empty, ErrorNote, SectionTitle, StatTile } from "@/components/ui";
import { Icon, IconName } from "@/components/icons";
import { Tip } from "@/components/tip";
import {
  RANGE_PRESETS, RangePreset, customRange, rangeFor, toInputValue, toQuery,
} from "@/lib/date-range";

/**
 * One project, in three tabs (user, 2026-10-06):
 *
 * - Overview: what the project is and watches — the summary tiles, then the
 *   domains that do not pass in Blocks (the user: "show it before Задачи по
 *   расписанию"), the jobs
 *   on a schedule, the keywords tracked, today's AMP domains (when the project
 *   has an AMP Rotator), and the project's GEOs.
 * - Positions: where its domains rank, and the export of that.
 * - Blocks: which of the domains in the SERPs are blocked, and handing them
 *   to the Proxy Checker that says so.
 *
 * The tab is kept in the address (#positions), so a reload or a link lands on
 * the same one; no hash is the Overview.
 */
type ProjectTab = "overview" | "positions" | "blocks" | "uploads";
const PROJECT_TABS: { id: ProjectTab; icon: IconName }[] = [
  { id: "overview", icon: "layers" },
  { id: "positions", icon: "activity" },
  { id: "blocks", icon: "shield" },
  // The log of CSV uploads (user, 2026-10-14).
  { id: "uploads", icon: "upload" },
];
/** A tab's sections, with air between them: the user asked for more than the
 *  page's usual gap once a tab held five or six blocks in a row. */
const PANEL = "space-y-10";
/** Addresses from before the tabs: the two cards had anchors of their own. */
const OLD_ANCHORS: Record<string, ProjectTab> = { "proxy-checker": "blocks", "project-geos": "overview" };

/** Which reading of the window is on screen. */
type PositionView = "latest" | "average";
const VIEWS: PositionView[] = ["latest", "average"];

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
  const { t, lang } = useT();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const [tab, setTab] = useState<ProjectTab>("overview");
  useEffect(() => {
    const fromHash = () => {
      const wanted = window.location.hash.slice(1);
      const next = PROJECT_TABS.find(x => x.id === wanted)?.id ?? OLD_ANCHORS[wanted];
      if (next) setTab(next);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  function pickTab(next: ProjectTab) {
    setTab(next);
    window.history.replaceState(null, "", `#${next}`);
  }

  const [project, setProject] = useState<Project | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [positions, setPositions] = useState<ProjectPositions | null>(null);
  const [averages, setAverages] = useState<ProjectAverages | null>(null);
  // Where things stand, or how they have held up. Two readings of the same
  // window rather than two tables stacked on one page: they cover the same
  // SERPs and the same keywords, so showing both at once doubles the scrolling
  // to say one thing twice.
  const [view, setView] = useState<PositionView>("latest");
  // Bumped when the project's GEOs are saved, so the tools that choose among
  // them (the Proxy Checker card) read the new list.
  const [geosVersion, setGeosVersion] = useState(0);
  // Bumped when the Proxy Checker card saved or sent something, so the blocks
  // table above it is read again.
  const [sendsVersion, setSendsVersion] = useState(0);
  // The upload form for a SERP export, and a count of uploads made: an upload
  // is a run, so the jobs, the positions and the blocks are all read again.
  const [showUpload, setShowUpload] = useState(false);
  // The last upload's result, as one line once the form has closed.
  const [lastUpload, setLastUpload] = useState<SerpCsvUpload | null>(null);
  // How many uploads the log holds, for its tab's label.
  const [uploadsCount, setUploadsCount] = useState<number | null>(null);
  // Bumped when the project's keywords were edited: the jobs hold them.
  const [jobsVersion, setJobsVersion] = useState(0);
  const [uploadsVersion, setUploadsVersion] = useState(0);
  // What the CSV export lists per query: the whole page (who holds the other
  // spots too) or only the project's own sites, as the tables do.
  const [exportSites, setExportSites] = useState<"all" | "ours">("all");
  // The export's choices stay folded behind one button until asked for.
  const [exportOpen, setExportOpen] = useState(false);
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

  // Only the view being looked at is fetched: the averaged one reads every run
  // in the range rather than the latest per row, and most visits never open it.
  // Switching back re-fetches rather than showing what was cached a while ago.
  // The same goes for the tab: positions are read while the Positions tab is
  // open, not on every visit to the Overview.
  const load = useCallback(async () => {
    if (!range || tab !== "positions") return;
    setLoading(true);
    try {
      if (view === "average") setAverages(await api.projectAverages(id, toQuery(range)));
      else setPositions(await api.projectPositions(id, toQuery(range)));
      setErr(null);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [id, range, view, tab, uploadsVersion]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.getProject(id).then(setProject).catch(e => setErr(e?.message ?? String(e)));
    // limit covers every job a project realistically holds; the jobs list page
    // is the place for paging through hundreds.
    api.listJobs({ projectId: id, limit: 200 }).then(p => setJobs(p.items)).catch(() => {});
  }, [id, uploadsVersion, jobsVersion]);

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

  // Counted off whichever view is on screen, so the line under the controls
  // always describes the table beneath it.
  const summary = useMemo(() => {
    // Spelled out per view rather than over a union: the two payloads carry
    // different row types, and collapsing them here to save six lines only
    // moves the cast somewhere less obvious.
    if (view === "latest") {
      return positions && {
        runs: positions.runs.length,
        rows: positions.serps.reduce((n, s) => n + s.rows.length, 0),
        serps: positions.serps.length,
      };
    }
    return averages && {
      runs: averages.runs.length,
      rows: averages.serps.reduce((n, s) => n + s.rows.length, 0),
      serps: averages.serps.length,
    };
  }, [view, positions, averages]);

  // A row is one measurement in the latest view and a whole window's worth in
  // the averaged one, so the two are counted in different words rather than
  // both being called measurements.
  const summaryText =
    summary && summary.runs > 0
      ? view === "latest"
        ? t.positions.fromRuns(summary.runs, summary.rows, summary.serps)
        : t.positions.fromRunsAvg(summary.runs, summary.rows, summary.serps)
      : null;

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
          <button
            type="button"
            onClick={() => { setShowUpload(v => !v); setLastUpload(null); }}
            aria-expanded={showUpload}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <Icon name="upload" className="h-3.5 w-3.5" />
            {t.serpCsv.button}
          </button>
          <Link
            href="/projects"
            className="rounded-lg border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            {t.positions.allProjects}
          </Link>
        </div>
      </div>

      {/* A SERP read by another tool, uploaded as a CSV: it becomes a run of
          this project. Above the tabs — it feeds all three. Once it is in, the
          form closes and the result stays as one line until dismissed. */}
      {showUpload && (
        <SerpCsvUploadCard
          projectId={id}
          onUploaded={done => { setUploadsVersion(v => v + 1); setLastUpload(done); setShowUpload(false); }}
          onClose={() => setShowUpload(false)}
        />
      )}
      {lastUpload && !showUpload && (
        <SerpCsvUploadBar
          done={lastUpload}
          onShowPositions={() => pickTab("positions")}
          onDismiss={() => setLastUpload(null)}
        />
      )}

      <div
        role="tablist"
        aria-label={project.name}
        className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800"
      >
        {PROJECT_TABS.map(({ id: tabId, icon }) => (
          <button
            key={tabId}
            type="button"
            role="tab"
            id={`project-tab-${tabId}`}
            aria-selected={tab === tabId}
            aria-controls={`project-panel-${tabId}`}
            onClick={() => pickTab(tabId)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === tabId
                ? "border-sky-600 text-slate-900 dark:border-sky-400 dark:text-slate-100"
                : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <Icon name={icon} className="h-3.5 w-3.5" />
            {t.projects.tabs[tabId]}
            {tabId === "uploads" && uploadsCount ? (
              <span className="rounded-full bg-slate-100 px-1.5 text-xs tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {uploadsCount}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* The panels stay mounted and are only hidden: a half-typed date range,
          an unsaved Proxy Checker choice or the answer to a send just made
          must survive a look at another tab. */}

      {/* ---------------- Overview: what the project is and watches ---------------- */}
      <div
        role="tabpanel"
        id="project-panel-overview"
        aria-labelledby="project-tab-overview"
        hidden={tab !== "overview"}
        className={PANEL}
      >
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

        {/* The domains in the SERPs that some proxy did not pass — the project's
            own, and their AMP domains. Right under the summary tiles and
            before the scheduled jobs, where the user asked for it. */}
        <ProjectNotPassingCard
          projectId={id}
          reloadKey={geosVersion + sendsVersion + uploadsVersion}
          onOpenBlocks={() => pickTab("blocks")}
        />

        {/* Only when some job is on a schedule: an empty "Scheduled jobs · 0"
            was noise (user, 2026-10-14: "This should not be displayed on the
            Project page if there are no scheduled jobs"). */}
        {scheduled.length > 0 && (
          <section className="space-y-2">
            <SectionTitle icon="clock" count={scheduled.length}>{t.positions.scheduled}</SectionTitle>
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
        )}

        {/* Editable one by one, with "clear all" (user, 2026-10-20). */}
        <ProjectKeywordsCard projectId={id} jobs={jobs} onSaved={() => setJobsVersion(v => v + 1)} />

        {/* Today's AMP domain of each of the project's domains, from its AMP
            Rotator. Renders nothing for a project that has none. */}
        <ProjectAmpCard projectId={id} />

        {/* The project's GEOs: every country it works in. The Proxy Checker
            card on the Blocks tab chooses among them and re-reads them on save. */}
        <section id="project-geos" className="scroll-mt-4">
          <ProjectGeosCard projectId={id} reloadKey={uploadsVersion} onSaved={() => setGeosVersion(v => v + 1)} />
        </section>
      </div>

      {/* ---------------- Positions: where the project's domains rank ---------------- */}
      <div
        role="tabpanel"
        id="project-panel-positions"
        aria-labelledby="project-tab-positions"
        hidden={tab !== "positions"}
        className={PANEL}
      >
        <section className="space-y-6">
          {/* The tables below as a file for SEO. Latest view only: the file is
              "which site holds which position", and an average has no page.
              Above the title row, as the user placed it, and folded behind one
              button until asked for (user, 2026-10-14: "move the export
              functionality to the Export CSV button, which is collapsed by
              default, to remove the clutter"), at the right (user: "Move it to
              the right"), its choices opening below it ("Make it collapsible to
              the bottom"). */}
          {view === "latest" && range && positions && positions.serps.length > 0 && (
            <div className="flex flex-col items-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setExportOpen(o => !o)}
                aria-expanded={exportOpen}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Icon name="download" className="h-3.5 w-3.5" />
                {t.positions.exportButton}
                {/* Points the way the choices open — down — and back up. */}
                <Icon name="chevronDown" className={`h-3 w-3 transition ${exportOpen ? "rotate-180" : ""}`} />
              </button>
              {exportOpen && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="text-slate-500 dark:text-slate-400">{t.positions.exportSites}</span>
                  <div
                    role="group"
                    aria-label={t.positions.exportSites}
                    className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700"
                  >
                    {(["all", "ours"] as const).map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setExportSites(s)}
                        aria-pressed={exportSites === s}
                        title={s === "all" ? t.positions.exportAllHint : t.positions.exportOursHint}
                        className={`border-l px-2.5 py-1 transition first:border-l-0 dark:border-slate-700 ${
                          exportSites === s
                            ? "bg-slate-900 font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                            : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                        }`}
                      >
                        {s === "all" ? t.positions.exportAll : t.positions.exportOurs}
                      </button>
                    ))}
                  </div>
                  {(["grid", "list"] as const).map(layout => (
                    <a
                      key={layout}
                      href={api.projectPositionsCsvUrl(id, { range: toQuery(range), layout, sites: exportSites, lang })}
                      title={layout === "grid" ? t.positions.exportGridHint : t.positions.exportListHint}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <Icon name="download" className="h-3.5 w-3.5" />
                      {layout === "grid" ? t.positions.exportGrid : t.positions.exportList}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <SectionTitle icon="activity">{t.positions.title}</SectionTitle>
            <div
              role="group"
              aria-label={t.positions.view}
              className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700"
            >
              {VIEWS.map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  title={v === "latest" ? t.positions.viewLatestHint : t.positions.viewAverageHint}
                  className={`border-l px-2.5 py-1 text-xs transition first:border-l-0 dark:border-slate-700 ${
                    view === v
                      ? "bg-slate-900 font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  }`}
                >
                  {v === "latest" ? t.positions.viewLatest : t.positions.viewAverage}
                </button>
              ))}
            </div>
            {/* Pushed to the right, away from the title and the view toggle:
                which reading you are looking at belongs beside the heading, when
                it was taken is a separate choice and reads better as its own
                group at the far end. */}
            <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
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
            {/* Folded behind an ⓘ: how many rows came from how many runs is
                worth being able to check, but it is not worth a sentence of
                prose between the controls and the table. */}
            <div className="flex items-center gap-2">
              {loading && (
                <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <Icon name="refresh" className="h-3 w-3 animate-spin" />
                  {t.common.loading}
                </span>
              )}
              {summaryText && <Tip text={summaryText} label={summaryText} />}
            </div>
          </div>

          {preset === "custom" && !range && (
            <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {t.positions.badRange}
            </div>
          )}
          {err && <ErrorNote>{err}</ErrorNote>}
          {view === "latest"
            ? positions && <PositionTable data={positions} />
            : averages && <AveragePositionTable data={averages} />}
        </section>
      </div>

      {/* ---------------- Blocks: are the domains reachable where they rank ---------------- */}
      <div
        role="tabpanel"
        id="project-panel-blocks"
        aria-labelledby="project-tab-blocks"
        hidden={tab !== "blocks"}
        className={PANEL}
      >
        {/* What the tab is opened for comes first: which of the domains in the
            SERPs are blocked. */}
        <ProjectBlocksCard projectId={id} reloadKey={geosVersion + sendsVersion + uploadsVersion} />

        {/* Where this project's own domains, found in the SERPs, are handed on
            to be checked for blocking, and WHEN — a project setting, so it
            lives on the project's page (the user: "it should be on the project
            page"). */}
        <section id="proxy-checker" className="scroll-mt-4">
          <ProjectProxyCheckerCard
            projectId={id}
            reloadKey={geosVersion + uploadsVersion}
            onChanged={() => setSendsVersion(v => v + 1)}
          />
        </section>
      </div>

      {/* ---------------- CSV uploads: what was uploaded, and removing one ---------------- */}
      <div
        role="tabpanel"
        id="project-panel-uploads"
        aria-labelledby="project-tab-uploads"
        hidden={tab !== "uploads"}
        className={PANEL}
      >
        <ProjectCsvUploadsCard
          projectId={id}
          reloadKey={uploadsVersion + sendsVersion}
          onChanged={() => setUploadsVersion(v => v + 1)}
          onCount={setUploadsCount}
        />
      </div>
    </div>
  );
}
