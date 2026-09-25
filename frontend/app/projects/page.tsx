"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { api, Project } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { ProjectForm } from "@/components/project-form";
import { Button, Card, Empty, ErrorNote } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";

/**
 * Projects: a client or site, the domains watched for it, and the jobs filed
 * under it.
 *
 * The project is also the folder the jobs list groups by, so the job count is
 * shown here — a project with no jobs draws no folder over there, and seeing
 * "0 jobs" is how you find out why.
 */
/** One fact about a project. The domains themselves are deliberately not here:
 *  a project built from permutations runs to hundreds of near-identical hosts,
 *  and eight of them plus "849 more" told the reader nothing the count did not.
 *  What a project IS — how much it watches, where, and on which engines — is
 *  what distinguishes one row from the next. */
function Fact({
  icon, children, title,
}: { icon: IconName; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800"
    >
      <Icon name={icon} className="h-3 w-3" />
      {children}
    </span>
  );
}

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
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t.projects.title}</h1>
        {!creating && (
          <Button className="ml-auto" onClick={() => { setCreating(true); setEditing(null); }}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            {t.projects.newProject}
          </Button>
        )}
      </div>

      <p className="max-w-3xl text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        {t.projects.lead}
      </p>

      {err && <ErrorNote>{err}</ErrorNote>}

      {creating && (
        <ProjectForm onSave={create} onCancel={() => setCreating(false)} busy={busy} />
      )}

      {projects === null ? (
        <div className="text-sm text-slate-600 dark:text-slate-400">{t.common.loading}</div>
      ) : projects.length === 0 && !creating ? (
        <Empty>{t.projects.empty}</Empty>
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
              <div
                key={p.id}
                className="min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                    <Icon name="layers" className="h-3.5 w-3.5" />
                  </span>
                  <Link
                    href={`/projects/${p.id}`}
                    className="font-semibold tracking-tight hover:underline"
                  >
                    {p.name}
                  </Link>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <Fact icon="globe">{t.projects.domainsCount(p.domains.length)}</Fact>
                    <Fact icon="keywords">{t.home.kwCount(p.keyword_count)}</Fact>
                    <Fact icon="list">{t.projects.jobsCount(p.job_count)}</Fact>
                    {p.geos.length > 0 && (
                      <Fact icon="flag" title={p.geos.join(", ")}>
                        {p.geos.slice(0, 2).join(", ")}
                        {p.geos.length > 2 && ` +${p.geos.length - 2}`}
                      </Fact>
                    )}
                    {p.engines.length > 0 && (
                      <Fact icon="search">
                        {p.engines
                          .map(e => (e === "yandex" ? t.variantLabel.yandex : t.variantLabel.google))
                          .join(", ")}
                      </Fact>
                    )}
                  </span>
                  <div className="ml-auto flex items-center gap-1.5">
                    {/* Straight into the job form with the folder preselected —
                        the common next step after making a project. */}
                    <Link
                      href={`/jobs/new?project=${p.id}`}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                    >
                      {t.projects.newJob}
                    </Link>
                    {p.job_count > 0 && (
                      <Link
                        href={`/?project=${p.id}`}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                      >
                        {t.projects.viewJobs}
                      </Link>
                    )}
                    <Button size="sm" onClick={() => { setEditing(p); setCreating(false); }}>
                      {t.common.edit}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => remove(p)}>
                      {t.common.delete}
                    </Button>
                  </div>
                </div>
                {p.notes && (
                  <div className="mt-1.5 text-sm text-slate-700 dark:text-slate-300">{p.notes}</div>
                )}

              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}
