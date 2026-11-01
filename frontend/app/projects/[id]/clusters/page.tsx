"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, Job, Project } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button, Callout, Card, Empty, SectionTitle, inputClass } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Choice, PickOne, SEARCH_FROM } from "@/components/floating-list";
import { projectKeywords } from "@/components/project-keywords";
import { parsePasted } from "@/lib/keyword-import";
import { useHoldPlace } from "@/lib/session-state";

/**
 * A project's clusters, to see and to edit (user, 2026-10-29: "let the user
 * view and edit clusters if needed" — "there should be a separate page for
 * viewing and editing the existing clusters").
 *
 * Every cluster with how many keywords it holds — renamed or taken off them
 * all at once — and every keyword of the project with its cluster, to change
 * one by one or from a pasted list. Nothing is written until "Save", as on the
 * project page; the keywords themselves are added and removed there.
 *
 * Made for many clusters (user, 2026-10-30: "How scalable and user-friendly
 * these will be when there are many clusters?"): the clusters' table has a
 * search and sorts by name or size, and the keywords' cluster choice is a
 * list with a search rather than the browser's own select.
 */

const key = (k: string) => k.trim().toLowerCase();
const PAGE = 300;
const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400";
const TD = "px-3 py-1.5 align-middle";
const LINK = "text-xs text-sky-700 hover:underline dark:text-sky-400";
/** The keyword filter's choices besides a cluster's name. */
const ALL = "\u0000all";
const NONE = "\u0000none";

type ClusterSort = { by: "name" | "count"; descending: boolean };

export default function ProjectClustersPage() {
  const { t } = useT();
  const x = t.clusters;
  const id = Number(useParams<{ id: string }>().id);
  const [project, setProject] = useState<Project | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  // Changes to save, by the keyword's key: a cluster, or null to take it away.
  const [edits, setEdits] = useState<Record<string, string | null>>({});
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState(ALL);
  const [findCluster, setFindCluster] = useState("");
  const [sort, setSort] = useState<ClusterSort>({ by: "name", descending: false });
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const keywordsCard = useRef<HTMLDivElement>(null);
  // A search or a cluster picked that leaves fewer rows must not move the
  // page, as on Position Tracking.
  const holdPlace = useHoldPlace();

  /** One cluster's keywords — or those without one — in the list below,
   *  brought into view (user, 2026-10-29: "When the user clicks on the
   *  cluster name, it should show the cluster contents"). */
  function showCluster(name: string) {
    holdPlace();
    setOnly(name);
    setLimit(PAGE);
    setQuery("");
    window.setTimeout(() => keywordsCard.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  useEffect(() => {
    Promise.all([api.getProject(id), api.listJobs({ projectId: id, limit: 200 })])
      .then(([p, j]) => { setProject(p); setJobs(j.items); setEdits({}); })
      .catch(e => setErr(e?.message ?? String(e)));
  }, [id, version]);

  const keywords = useMemo(() => projectKeywords(jobs), [jobs]);
  const saved = project?.keyword_clusters ?? {};
  const clusterOf = (k: string): string | null => (key(k) in edits ? edits[key(k)] : saved[key(k)] ?? null);

  // Every cluster, with how many keywords hold it as things stand on screen.
  const summary = useMemo(() => {
    const counts = new Map<string, number>();
    let none = 0;
    for (const k of keywords) {
      const c = clusterOf(k);
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
      else none++;
    }
    return { clusters: [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])), none };
  }, [keywords, edits, saved]);  // clusterOf reads both

  /** One keyword's cluster as typed; back to what is saved is no change. */
  function setCluster(k: string, value: string | null) {
    const now = value?.trim() || null;
    const was = saved[key(k)] ?? null;
    setEdits(e => {
      const next = { ...e };
      if (now === was) delete next[key(k)];
      else next[key(k)] = now;
      return next;
    });
    setMsg(null);
  }

  /** Every keyword of one cluster moved to another name — or to none. */
  function moveCluster(from: string, to: string | null) {
    for (const k of keywords) if (clusterOf(k) === from) setCluster(k, to);
  }

  function applyBulk() {
    const known = new Map(keywords.map(k => [key(k), k]));
    let set = 0;
    let unknown = 0;
    for (const line of parsePasted(bulk)) {
      const k = known.get(key(line.keyword));
      if (!k) { unknown++; continue; }
      if (line.cluster === undefined) continue;
      setCluster(k, line.cluster);
      set++;
    }
    setBulk("");
    setMsg(x.bulkDone(set, unknown));
  }

  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await api.addProjectKeywords(id, [], edits);
      setVersion(v => v + 1);
      setMsg(t.common.saved);
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally { setBusy(false); }
  }

  const q = key(query);
  const shown = keywords.filter(k => {
    const c = clusterOf(k);
    if (only === NONE ? c !== null : only !== ALL && c !== only) return false;
    return !q || key(k).includes(q) || (c ?? "").toLowerCase().includes(q);
  });
  const changes = Object.keys(edits).length;

  // The clusters' table: found by name, in the order asked for — the biggest
  // first, the first time it is sorted by size.
  const cq = findCluster.trim().toLowerCase();
  const listed = summary.clusters
    .filter(([name]) => !cq || name.toLowerCase().includes(cq))
    .sort((a, b) => {
      const by = sort.by === "count" ? a[1] - b[1] || 0 : a[0].localeCompare(b[0]);
      return (sort.descending ? -by : by) || a[0].localeCompare(b[0]);
    });
  const sortBy = (by: ClusterSort["by"]) =>
    setSort(s => ({ by, descending: s.by === by ? !s.descending : by === "count" }));
  function sortHead(by: ClusterSort["by"], label: string, right = false) {
    const active = sort.by === by;
    return (
      <th className={`${TH} ${right ? "text-right" : ""}`} aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}>
        <button
          type="button"
          onClick={() => sortBy(by)}
          className={`inline-flex items-center gap-1 uppercase hover:text-slate-900 dark:hover:text-slate-100 ${active ? "text-slate-900 dark:text-slate-100" : ""}`}
        >
          {label}
          <Icon name="chevronDown" className={`h-3 w-3 transition ${active ? "" : "opacity-30"} ${active && !sort.descending ? "rotate-180" : ""}`} />
        </button>
      </th>
    );
  }
  const onlyChoices: Choice[] = [
    { value: ALL, label: x.allClusters, text: x.allClusters },
    { value: NONE, label: <span className="italic">{x.none}</span>, text: x.none },
    ...summary.clusters.map(([name]) => ({ value: name, label: name, text: name })),
  ];

  if (!project) {
    return err ? <Callout tone="bad" icon="alert">{err}</Callout> : <div className="text-sm text-slate-500">{t.common.loading}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href={`/projects/${id}#overview`} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:underline dark:text-slate-400">
          <Icon name="chevronRight" className="h-3.5 w-3.5 rotate-180" />{project.name}
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{x.title}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">{x.help}</p>
      </div>

      {/* Nothing is written until here. */}
      {(changes > 0 || msg || err) && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          {changes > 0 && (
            <>
              <Button variant="primary" size="sm" disabled={busy} onClick={save}>{t.common.save}</Button>
              <span className="text-sm text-slate-700 dark:text-slate-300">{x.changes(changes)}</span>
              <button type="button" onClick={() => { setEdits({}); setMsg(null); }} className="text-xs underline underline-offset-2">{x.undo}</button>
            </>
          )}
          {msg && <span className="text-sm text-emerald-700 dark:text-emerald-300">{msg}</span>}
          {err && <span className="text-sm text-rose-700 dark:text-rose-300">{err}</span>}
        </div>
      )}

      <Card title={<SectionTitle icon="layers" count={summary.clusters.length}>{x.clustersTitle}</SectionTitle>}>
        {summary.clusters.length === 0 ? (
          <Empty>{x.noClusters}</Empty>
        ) : (
          <div className="space-y-2">
          {summary.clusters.length >= SEARCH_FROM && (
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={findCluster}
                onChange={e => { holdPlace(); setFindCluster(e.target.value); }}
                placeholder={x.findCluster}
                className={`${inputClass} max-w-xs py-1 text-sm`}
              />
              {cq && <span className="text-xs text-slate-500 dark:text-slate-400">{x.shown(listed.length, summary.clusters.length)}</span>}
            </div>
          )}
          {/* A long list scrolls in its own box, so the keywords below stay in reach. */}
          <div className="max-h-[32rem] overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-[1] bg-slate-50 dark:bg-slate-900">
                <tr>
                  {sortHead("name", x.cluster)}
                  {sortHead("count", x.keywords, true)}
                  <th className={TH} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {listed.length === 0 && (
                  <tr><td colSpan={3} className={`${TD} text-slate-500 dark:text-slate-400`}>{x.nothingFound}</td></tr>
                )}
                {listed.map(([name, count]) => (
                  <tr key={name}>
                    <td className={TD}>
                      {renaming?.from === name ? (
                        <span className="flex items-center gap-2">
                          <input
                            autoFocus
                            value={renaming.to}
                            onChange={e => setRenaming({ from: name, to: e.target.value })}
                            onKeyDown={e => {
                              if (e.key === "Enter" && renaming.to.trim()) { moveCluster(name, renaming.to); setRenaming(null); }
                              if (e.key === "Escape") setRenaming(null);
                            }}
                            className={`${inputClass} max-w-xs py-1 text-sm`}
                          />
                          <Button size="sm" disabled={!renaming.to.trim()} onClick={() => { moveCluster(name, renaming.to); setRenaming(null); }}>OK</Button>
                          <button type="button" onClick={() => setRenaming(null)} className={LINK}>{x.cancel}</button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => showCluster(name)}
                          title={x.showHint(name)}
                          className="font-medium text-slate-900 hover:text-sky-700 hover:underline dark:text-slate-100 dark:hover:text-sky-400"
                        >
                          {name}
                        </button>
                      )}
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{count}</td>
                    <td className={`${TD} whitespace-nowrap text-right`}>
                      <span className="inline-flex gap-3">
                        <button type="button" onClick={() => showCluster(name)} className={LINK}>{x.show}</button>
                        <button type="button" onClick={() => setRenaming({ from: name, to: name })} className={LINK}>{x.rename}</button>
                        <button
                          type="button"
                          onClick={() => { if (window.confirm(x.removeConfirm(name, count))) moveCluster(name, null); }}
                          className="text-xs text-rose-700 hover:underline dark:text-rose-400"
                        >
                          {x.remove}
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
                {!cq && <tr>
                  <td className={TD}>
                    <button
                      type="button"
                      onClick={() => showCluster(NONE)}
                      className="italic text-slate-500 hover:text-sky-700 hover:underline dark:text-slate-400 dark:hover:text-sky-400"
                    >
                      {x.none}
                    </button>
                  </td>
                  <td className={`${TD} text-right tabular-nums text-slate-500 dark:text-slate-400`}>{summary.none}</td>
                  <td className={`${TD} text-right`}>
                    <button type="button" onClick={() => showCluster(NONE)} className={LINK}>{x.show}</button>
                  </td>
                </tr>}
              </tbody>
            </table>
          </div>
          </div>
        )}
      </Card>

      <div ref={keywordsCard} className="scroll-mt-20">
        <Card title={<SectionTitle icon="keywords" count={keywords.length}>{x.keywordsTitle}</SectionTitle>}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={query}
                onChange={e => { holdPlace(); setQuery(e.target.value); setLimit(PAGE); }}
                placeholder={x.search}
                className={`${inputClass} max-w-xs py-1 text-sm`}
              />
              <PickOne
                choices={onlyChoices}
                value={only}
                onPick={v => { holdPlace(); setOnly(v); setLimit(PAGE); }}
                findLabel={x.findCluster}
                nothing={x.nothingFound}
                className={`min-w-40 rounded-lg border bg-white px-2 py-1 text-sm text-slate-900 dark:bg-slate-950 dark:text-slate-100 ${
                  only === ALL ? "border-slate-300 dark:border-slate-700" : "border-sky-500 dark:border-sky-400"
                }`}
              />
              <Button size="sm" onClick={() => setBulkOpen(o => !o)} aria-expanded={bulkOpen} className="ml-auto">
                <Icon name="list" className="h-3.5 w-3.5" />{x.bulk}
              </Button>
            </div>

            {bulkOpen && (
              <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <p className="text-xs text-slate-600 dark:text-slate-400">{x.bulkHint}</p>
                <textarea
                  value={bulk}
                  onChange={e => setBulk(e.target.value)}
                  rows={5}
                  placeholder={x.bulkPlaceholder}
                  className={`${inputClass} font-mono text-xs`}
                />
                <Button size="sm" disabled={!bulk.trim()} onClick={applyBulk}>{x.bulkApply}</Button>
              </div>
            )}

            {keywords.length === 0 ? (
              <Empty>{x.noKeywords}</Empty>
            ) : shown.length === 0 ? (
              <Empty>{x.nothingFound}</Empty>
            ) : (
              <>
                {/* Names to pick from while typing: the clusters there are. */}
                <datalist id="project-clusters">
                  {summary.clusters.map(([name]) => <option key={name} value={name} />)}
                </datalist>
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-900/50">
                      <tr>
                        <th className={TH}>{x.keyword}</th>
                        <th className={TH}>{x.cluster}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {shown.slice(0, limit).map(k => {
                        const changed = key(k) in edits;
                        return (
                          <tr key={key(k)} className={changed ? "bg-amber-50 dark:bg-amber-950/30" : undefined}>
                            <td className={TD}>{k}</td>
                            <td className={TD}>
                              <input
                                list="project-clusters"
                                value={clusterOf(k) ?? ""}
                                onChange={e => setCluster(k, e.target.value)}
                                placeholder={x.none}
                                className={`${inputClass} max-w-xs py-1 text-sm`}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                  {x.shown(Math.min(limit, shown.length), shown.length)}
                  {shown.length > limit && (
                    <button type="button" onClick={() => setLimit(l => l + PAGE)} className={LINK}>{x.more}</button>
                  )}
                </div>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
