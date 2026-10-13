"use client";
import { useEffect, useMemo, useState } from "react";
import { api, ProjectGeos } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { MultiCombobox, Option } from "./multi-combobox";
import { Button, Callout, Card, Pill, SectionTitle } from "@/components/ui";
import { Icon } from "@/components/icons";

/**
 * The project's GEOs: every country the project works in, set here once
 * (user, 2026-10-05: "first the user should specify all GEOs on the project
 * page"). The connected tools choose among them — the Proxy Checker card below
 * picks whose SERP findings it is sent.
 *
 * Until a list is saved, the countries the project's jobs already check stand
 * in for it, so an untouched project behaves exactly as it did before.
 */
export function ProjectGeosCard({ projectId, onSaved, reloadKey = 0 }: {
  projectId: number;
  onSaved?: () => void;
  /** Bumped when the list may have changed elsewhere: a CSV upload adds its
   *  countries to it. */
  reloadKey?: number;
}) {
  const { t } = useT();
  const s = t.tools.geos;
  const [data, setData] = useState<ProjectGeos | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function take(next: ProjectGeos) {
    setData(next);
    setSelected(next.geos ?? next.effective);
  }
  useEffect(() => {
    api.getProjectGeos(projectId).then(take).catch(e => setErr(e?.message ?? String(e)));
    api.getCountries().then(rows => setNames(new Map(rows.map(r => [r.code, r.name])))).catch(() => {});
  }, [projectId, reloadKey]);

  // Every country, plus any code already on the project that the list does not
  // know (it must stay visible to be removable).
  const options = useMemo<Option<string>[]>(() => {
    const all = new Map(names);
    for (const code of [...selected, ...(data?.from_jobs ?? [])]) if (!all.has(code)) all.set(code, code);
    return [...all.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([code, name]) => ({ value: code, label: name, sub: code }));
  }, [names, selected, data]);

  async function save() {
    setBusy(true); setMsg(null); setErr(null);
    try {
      take(await api.saveProjectGeos(projectId, selected));
      setMsg(t.common.saved);
      onSaved?.();
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally { setBusy(false); }
  }

  if (!data) return err ? <Callout tone="bad" icon="alert">{err}</Callout> : null;

  const saved = data.geos ?? data.effective;
  const dirty = data.geos === null
    ? true      // nothing saved yet: saving what is shown is itself a change
    : selected.length !== saved.length || selected.some(g => !saved.includes(g));
  const unchecked = selected.filter(g => !data.from_jobs.includes(g));

  return (
    <Card
      title={<SectionTitle icon="flag" count={selected.length}>{s.title}</SectionTitle>}
      actions={data.geos === null ? <Pill tone="neutral" icon="dash">{s.notSaved}</Pill> : undefined}
    >
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{s.help}</p>
        <MultiCombobox<string>
          label={s.label}
          placeholder={s.placeholder}
          options={options}
          selected={selected}
          onChange={next => { setSelected(next); setMsg(null); }}
          renderChip={code => `${code} · ${names.get(code) ?? code}`}
        />
        {data.geos === null && (
          <p className="text-xs text-slate-600 dark:text-slate-400">{s.fromJobs}</p>
        )}
        {unchecked.length > 0 && (
          <Callout tone="warn" icon="alert">{s.noJob(unchecked.join(", "))}</Callout>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" disabled={busy || !dirty} onClick={save}>{t.common.save}</Button>
          {msg && (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
              <Icon name="check" className="h-3.5 w-3.5" />{msg}
            </span>
          )}
        </div>
        {err && <Callout tone="bad" icon="alert">{err}</Callout>}
      </div>
    </Card>
  );
}
