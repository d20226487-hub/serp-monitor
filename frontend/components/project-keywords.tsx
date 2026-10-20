"use client";
import { useEffect, useMemo, useState } from "react";
import { api, Job } from "@/lib/api";
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
 */

const key = (k: string) => k.trim().toLowerCase();

/** Every keyword the jobs hold, once each, whatever its case. */
export function projectKeywords(jobs: Job[]): string[] {
  const seen = new Map<string, string>();
  for (const j of jobs) for (const k of j.keywords) if (k.trim() && !seen.has(key(k))) seen.set(key(k), k.trim());
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

const CHIP = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs";

export function ProjectKeywordsCard({ projectId, jobs, onSaved }: {
  projectId: number;
  jobs: Job[];
  /** Keywords were saved: the jobs have to be read again. */
  onSaved: () => void;
}) {
  const { t } = useT();
  const x = t.projectKeywords;
  const current = useMemo(() => projectKeywords(jobs), [jobs]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [cleared, setCleared] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Read again after a save: start from what the project now holds.
  useEffect(() => { setRemoved(new Set()); setCleared(false); setAdded([]); }, [jobs]);

  const query = key(text);
  const kept = current.filter(k => !removed.has(key(k)));
  const shown = query ? kept.filter(k => key(k).includes(query)) : kept;
  const shownAdded = query ? added.filter(k => key(k).includes(query)) : added;
  const dirty = removed.size > 0 || added.length > 0;

  function addTyped() {
    const k = text.trim();
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
      if (added.length > 0) await api.addProjectKeywords(projectId, added);
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
          <Button
            size="sm"
            variant="danger"
            className="ml-auto"
            disabled={busy || kept.length + added.length === 0}
            onClick={() => { setRemoved(new Set(current.map(key))); setCleared(true); setAdded([]); setMsg(null); }}
          >
            <Icon name="trash" className="h-3.5 w-3.5" />{x.clearAll}
          </Button>
        </div>

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
                <span className="text-xs text-slate-600 dark:text-slate-400">{x.pending(removed.size, added.length)}</span>
                <button
                  type="button"
                  onClick={() => { setRemoved(new Set()); setCleared(false); setAdded([]); setMsg(null); }}
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
