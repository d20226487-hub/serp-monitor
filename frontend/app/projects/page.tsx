"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, Project } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { ProjectForm } from "@/components/project-form";

/**
 * Projects: a client or site, the domains watched for it, and the jobs filed
 * under it.
 *
 * The project is also the folder the jobs list groups by, so the job count is
 * shown here — a project with no jobs draws no folder over there, and seeing
 * "0 jobs" is how you find out why.
 */
export default function ProjectsPage() {
  const { t } = useT();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProjects(await api.listProjects());
      setErr(null);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create(body: { name: string; domains: string[]; notes: string | null }) {
    setBusy(true);
    try {
      await api.createProject(body);
      setCreating(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function save(id: number, body: { name: string; domains: string[]; notes: string | null }) {
    setBusy(true);
    try {
      await api.updateProject(id, body);
      setEditing(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Project) {
    // Naming the consequence rather than asking "are you sure": the jobs are
    // not deleted with the folder, and that is the thing someone hesitating
    // over this button actually wants to know.
    if (!confirm(t.projects.deleteConfirm(p.name, p.job_count))) return;
    await api.deleteProject(p.id);
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t.projects.title}</h1>
        {!creating && (
          <button
            onClick={() => { setCreating(true); setEditing(null); }}
            className="px-3 py-1.5 rounded-md bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-sm"
          >
            {t.projects.newProject}
          </button>
        )}
      </div>

      <p className="text-sm text-neutral-600 dark:text-neutral-400 max-w-3xl">
        {t.projects.lead}
      </p>

      {err && <div className="text-sm text-red-600 dark:text-red-400">{err}</div>}

      {creating && (
        <ProjectForm onSave={create} onCancel={() => setCreating(false)} busy={busy} />
      )}

      {projects === null ? (
        <div className="text-sm text-neutral-600 dark:text-neutral-400">{t.common.loading}</div>
      ) : projects.length === 0 && !creating ? (
        <div className="text-neutral-600 dark:text-neutral-400 text-sm border rounded-md p-6 dark:border-neutral-700">
          {t.projects.empty}
        </div>
      ) : (
        <div className="space-y-2">
          {projects.map(p => (
            editing?.id === p.id ? (
              <ProjectForm
                key={p.id}
                initial={p}
                onSave={body => save(p.id, body)}
                onCancel={() => setEditing(null)}
                busy={busy}
              />
            ) : (
              <div key={p.id} className="border rounded-md px-4 py-3 dark:border-neutral-700">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-neutral-600 dark:text-neutral-400">
                    {t.projects.domainsCount(p.domains.length)} · {t.projects.jobsCount(p.job_count)}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    {/* Straight into the job form with the folder preselected —
                        the common next step after making a project. */}
                    <Link
                      href={`/jobs/new?project=${p.id}`}
                      className="text-sm px-2 py-1 rounded border dark:border-neutral-700"
                    >
                      {t.projects.newJob}
                    </Link>
                    {p.job_count > 0 && (
                      <Link
                        href={`/?project=${p.id}`}
                        className="text-sm px-2 py-1 rounded border dark:border-neutral-700"
                      >
                        {t.projects.viewJobs}
                      </Link>
                    )}
                    <button
                      onClick={() => { setEditing(p); setCreating(false); }}
                      className="text-sm px-2 py-1 rounded border dark:border-neutral-700"
                    >
                      {t.common.edit}
                    </button>
                    <button
                      onClick={() => remove(p)}
                      className="text-sm px-2 py-1 rounded border dark:border-neutral-700 text-red-600 dark:text-red-400"
                    >
                      {t.common.delete}
                    </button>
                  </div>
                </div>
                {p.notes && (
                  <div className="text-xs text-neutral-600 dark:text-neutral-400 mt-1">{p.notes}</div>
                )}
                {p.domains.length > 0 && (
                  <div className="text-xs font-mono text-neutral-600 dark:text-neutral-400 mt-1.5 break-all">
                    {p.domains.slice(0, 8).join(" · ")}
                    {p.domains.length > 8 && ` · ${t.projects.andMore(p.domains.length - 8)}`}
                  </div>
                )}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}
