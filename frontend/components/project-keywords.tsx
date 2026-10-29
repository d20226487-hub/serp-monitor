"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, Job } from "@/lib/api";
import { KeywordLine, parseKeywordFile, parsePasted, trimSeparators } from "@/lib/keyword-import";
import { useT } from "@/lib/i18n";
import { Button, Callout, SectionTitle, inputClass } from "@/components/ui";
import { Icon } from "@/components/icons";

/**
 * The keywords the project tracks — a list to see, and to correct one by one
 * or clear (user, 2026-10-20: "remove/add keywords from/to the project one by
 * one like GEOs + clear all button", and on a first version with a job picker
 * and an explanation: "the purpose of this box is just to show what keywords
 * are tracked. You overthought it").
 *
 * Removing takes a keyword out of the project — out of every job that has it.
 * Adding puts it into the project's own list. Like the GEOs, nothing changes
 * until "Save".
 *
 * Keywords also come in bulk — a pasted list or a CSV file — each with an
 * optional cluster (user, 2026-10-29: "Let the user bulk add keywords by bulk
 * pasting or uploading CSV file … Plus let the user add the cluster next to
 * the keyword"); a keyword the project has already only gets its cluster.
 * A chip shows its keyword's cluster.
 */

const key = (k: string) => k.trim().toLowerCase();

/** Every keyword the jobs hold, once each, whatever its case. */
export function projectKeywords(jobs: Job[]): string[] {
  const seen = new Map<string, string>();
  for (const j of jobs) for (const k of j.keywords) if (k.trim() && !seen.has(key(k))) seen.set(key(k), k.trim());
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

const CHIP = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs";

export function ProjectKeywordsCard({ projectId, jobs, clusters, onSaved }: {
  projectId: number;
  jobs: Job[];
  /** The project's clusters: keyword (lower case, trimmed) → cluster. */
  clusters: Record<string, string>;
  /** Keywords were saved: the jobs have to be read again. */
  onSaved: () => void;
}) {
  const { t } = useT();
  const x = t.projectKeywords;
  const current = useMemo(() => projectKeywords(jobs), [jobs]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [cleared, setCleared] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  // Clusters to set on saving, by the keyword's key; null takes one away.
  const [clusterEdits, setClusterEdits] = useState<Record<string, string | null>>({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Read again after a save: start from what the project now holds.
  useEffect(() => { setRemoved(new Set()); setCleared(false); setAdded([]); setClusterEdits({}); }, [jobs]);

  const query = key(text);
  const kept = current.filter(k => !removed.has(key(k)));
  const shown = query ? kept.filter(k => key(k).includes(query)) : kept;
  const shownAdded = query ? added.filter(k => key(k).includes(query)) : added;
  const editCount = Object.keys(clusterEdits).length;
  const dirty = removed.size > 0 || added.length > 0 || editCount > 0;
  const clusterOf = (k: string) => (key(k) in clusterEdits ? clusterEdits[key(k)] : clusters[key(k)]) || null;

  /** Keywords from a list or a file: the new ones to add, a removed one back,
   *  and every cluster given to be set. */
  function stage(lines: KeywordLine[]) {
    setMsg(null); setErr(null);
    if (lines.length === 0) { setErr(x.nothingRead); return; }
    const nextAdded = [...added];
    const nextRemoved = new Set(removed);
    const nextEdits = { ...clusterEdits };
    let newOnes = 0;
    let clusterCount = 0;
    for (const { keyword, cluster } of lines) {
      const k = trimSeparators(keyword);
      if (!k) continue;
      if (nextRemoved.has(key(k))) nextRemoved.delete(key(k));
      else if (![...current, ...nextAdded].some(a => key(a) === key(k))) { nextAdded.push(k); newOnes++; }
      if (cluster !== undefined) {
        const was = clusters[key(k)] ?? null;
        const now = cluster.trim() || null;
        if (now !== was) nextEdits[key(k)] = now;
        else delete nextEdits[key(k)];
        clusterCount++;
      }
    }
    setAdded(nextAdded); setRemoved(nextRemoved); setClusterEdits(nextEdits);
    if (nextRemoved.size === 0) setCleared(false);
    setMsg(x.staged(newOnes, clusterCount));
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    try { stage(parseKeywordFile(await file.text())); } catch (e: any) { setErr(e?.message ?? String(e)); }
  }

  function addTyped() {
    const k = trimSeparators(text);
    if (!k) return;
    setMsg(null);
    if (removed.has(key(k))) {
      const next = new Set(removed);       // typed back after removing it
      next.delete(key(k));
      setRemoved(next);
      setCleared(false);
    } else if (![...kept, ...added].some(a => key(a) === key(k))) {
      setAdded([...added, k]);
    }
    setText("");
  }

  function remove(k: string) {
    setMsg(null);
    if (added.some(a => key(a) === key(k))) { setAdded(added.filter(a => key(a) !== key(k))); return; }
    setRemoved(new Set([...removed, key(k)]));
  }

  async function save() {
    const drop = current.filter(k => removed.has(key(k)));
    if (drop.length > 0 && !window.confirm(x.confirm(drop.length))) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      if (drop.length > 0) await api.removeProjectKeywords(projectId, cleared ? { all: true } : { keywords: drop });
      if (added.length > 0 || editCount > 0) await api.addProjectKeywords(projectId, added, clusterEdits);
      setMsg(t.common.saved);
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally { setBusy(false); }
  }

  const chip = (k: string, fresh: boolean) => (
    <span
      key={(fresh ? "+" : "") + k}
      className={`${CHIP} ${fresh
        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}
    >
      {k}
      {clusterOf(k) && <span className="opacity-60">· {clusterOf(k)}</span>}
      <button type="button" onClick={() => remove(k)} aria-label={x.removeOne(k)} title={x.removeOne(k)}
        className="rounded-full opacity-50 hover:opacity-100">
        <Icon name="cross" className="h-3 w-3" />
      </button>
    </span>
  );

  return (
    <section className="space-y-2">
      <SectionTitle icon="keywords" count={kept.length + added.length}>{t.positions.keywords}</SectionTitle>
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={text}
            onChange={e => { setText(e.target.value); setMsg(null); }}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTyped(); } }}
            placeholder={x.placeholder}
            className={`${inputClass} max-w-sm`}
          />
          <Button size="sm" disabled={!text.trim()} onClick={addTyped}>
            <Icon name="plus" className="h-3.5 w-3.5" />{x.add}
          </Button>
          <Button size="sm" onClick={() => setBulkOpen(o => !o)} aria-expanded={bulkOpen}>
            <Icon name="list" className="h-3.5 w-3.5" />{x.bulk}
          </Button>
          {/* Clusters are seen and edited on a page of their own (user,
              2026-10-29: "there should be a separate page for viewing and
              editing the existing clusters"). */}
          <Link
            href={`/projects/${projectId}/clusters`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Icon name="layers" className="h-3.5 w-3.5" />{t.clusters.open}
          </Link>
          <Button
            size="sm"
            variant="danger"
            className="ml-auto"
            disabled={busy || kept.length + added.length === 0}
            onClick={() => { setRemoved(new Set(current.map(key))); setCleared(true); setAdded([]); setClusterEdits({}); setMsg(null); }}
          >
            <Icon name="trash" className="h-3.5 w-3.5" />{x.clearAll}
          </Button>
        </div>

        {bulkOpen && (
          <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <p className="text-xs text-slate-600 dark:text-slate-400">{x.bulkHint}</p>
            <textarea
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
              rows={5}
              placeholder={x.bulkPlaceholder}
              className={`${inputClass} font-mono text-xs`}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={!bulkText.trim()} onClick={() => { stage(parsePasted(bulkText)); setBulkText(""); }}>
                <Icon name="plus" className="h-3.5 w-3.5" />{x.bulkAdd}
              </Button>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                <Icon name="upload" className="h-3.5 w-3.5" />{x.csvUpload}
                <input
                  type="file"
                  accept=".csv,.txt,text/csv,text/plain"
                  className="sr-only"
                  onChange={e => { readFile(e.target.files?.[0]); e.target.value = ""; }}
                />
              </label>
              <span className="text-xs text-slate-500 dark:text-slate-400">{x.csvHint}</span>
            </div>
          </div>
        )}

        {kept.length + added.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{x.empty}</p>
        ) : shown.length + shownAdded.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{x.nothingFound}</p>
        ) : (
          <div className="flex max-h-72 min-w-0 flex-wrap gap-1.5 overflow-y-auto">
            {shownAdded.map(k => chip(k, true))}
            {shown.map(k => chip(k, false))}
          </div>
        )}

        {(dirty || msg) && (
          <div className="flex flex-wrap items-center gap-2">
            {dirty && (
              <>
                <Button variant="primary" size="sm" disabled={busy} onClick={save}>{t.common.save}</Button>
                <span className="text-xs text-slate-600 dark:text-slate-400">{x.pending(removed.size, added.length, editCount)}</span>
                <button
                  type="button"
                  onClick={() => { setRemoved(new Set()); setCleared(false); setAdded([]); setClusterEdits({}); setMsg(null); }}
                  className="text-xs underline underline-offset-2"
                >
                  {x.undo}
                </button>
              </>
            )}
            {msg && (
              <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
                <Icon name="check" className="h-3.5 w-3.5" />{msg}
              </span>
            )}
          </div>
        )}
        {err && <Callout tone="bad" icon="alert">{err}</Callout>}
      </div>
    </section>
  );
}
