"use client";
import { useMemo, useState } from "react";
import { Project } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { parseDomains } from "@/lib/domain-paste";

/**
 * Create or edit a project: a name, and the domains being watched for it.
 *
 * The domains are pasted as a block rather than added one at a time, because
 * they arrive as a block — a column out of a spreadsheet, a list of URLs, a
 * comma-separated line from an email. What the paste reduces to is shown live
 * underneath: forty pasted lines that quietly became thirty-seven is the
 * mistake worth catching while the textarea is still open, not after saving.
 */
export function ProjectForm({
  initial, onSave, onCancel, busy,
}: {
  initial?: Project | null;
  onSave: (body: { name: string; domains: string[]; notes: string | null }) => Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}) {
  const { t } = useT();
  const [name, setName] = useState(initial?.name ?? "");
  // Stored normalised, so reopening shows exactly what is saved rather than
  // whatever was originally pasted.
  const [domainsText, setDomainsText] = useState((initial?.domains ?? []).join("\n"));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseDomains(domainsText), [domainsText]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(t.projects.nameRequired);
      return;
    }
    try {
      await onSave({
        name: name.trim(),
        domains: parsed.domains,
        notes: notes.trim() || null,
      });
    } catch (err: any) {
      // A duplicate name comes back as a 409 and is the one failure a person
      // can fix from here, so it belongs on the form rather than in a toast.
      setError(err?.message ?? String(err));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 border rounded-md p-4 dark:border-neutral-700">
      <div className="space-y-1.5">
        <label className="text-sm font-medium">{t.projects.name}</label>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t.projects.namePlaceholder}
          className="w-full px-3 py-2 rounded-md border bg-white dark:bg-neutral-900 dark:border-neutral-700"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">
          {t.projects.domains}{" "}
          <span className="text-xs text-neutral-600 dark:text-neutral-400">
            {t.projects.domainsHint}
          </span>
        </label>
        <textarea
          value={domainsText}
          onChange={e => setDomainsText(e.target.value)}
          rows={8}
          placeholder={t.projects.domainsPlaceholder}
          className="w-full px-3 py-2 rounded-md border font-mono text-sm bg-white dark:bg-neutral-900 dark:border-neutral-700"
        />
        <div className="text-xs space-y-0.5">
          <div className="text-neutral-600 dark:text-neutral-400">
            {t.projects.domainsCount(parsed.domains.length)}
            {parsed.duplicates > 0 && ` · ${t.projects.domainsDuplicates(parsed.duplicates)}`}
          </div>
          {parsed.rejected.length > 0 && (
            <div className="text-amber-700 dark:text-amber-300">
              {t.projects.domainsRejected(
                parsed.rejected.length,
                parsed.rejected.slice(0, 5).join(", ")
                  + (parsed.rejected.length > 5 ? "…" : ""),
              )}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">
          {t.projects.notes}{" "}
          <span className="text-xs text-neutral-600 dark:text-neutral-400">
            {t.common.optional}
          </span>
        </label>
        <input
          value={notes}
          onChange={e => setNotes(e.target.value)}
          className="w-full px-3 py-2 rounded-md border bg-white dark:bg-neutral-900 dark:border-neutral-700"
        />
      </div>

      {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-1.5 rounded-md bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-sm disabled:opacity-50"
        >
          {initial ? t.common.save : t.projects.create}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md border dark:border-neutral-700 text-sm"
        >
          {t.common.cancel}
        </button>
      </div>
    </form>
  );
}
