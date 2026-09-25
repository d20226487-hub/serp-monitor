"use client";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { OpportunityFormula } from "@/lib/opportunity";

/**
 * Editor for the opportunity formula.
 *
 * One component, two mount points: Settings edits the global, the run page
 * edits that run's override. They are the same fields with the same bounds, and
 * keeping them one component is what stops the two screens drifting apart as
 * fields are added.
 *
 * Every field shows what it reverts to, because these numbers are unfamiliar
 * on sight — "0.35" means nothing without knowing the default was 0.35.
 */

type FieldSpec = {
  key: keyof OpportunityFormula;
  min: number;
  max: number;
  step: number;
};

type Group = {
  /** i18n key under t.formula.groups. */
  id: string;
  fields: FieldSpec[];
  /** Rendered after the numeric fields of this group. */
  curve?: boolean;
};

// Grouped by what a field DOES, not by its type. Fifteen numbers in one grid
// gives no clue that ai_medium and ur_soft affect completely different halves
// of the score; four short sections do.
//
// Bounds mirror _OPPORTUNITY_BOUNDS on the server, which re-validates and
// silently falls back on anything out of range — these are a convenience for
// the user, not the guarantee.
const GROUPS: Group[] = [
  {
    id: "difficulty",
    fields: [
      { key: "ai_low", min: 0, max: 1, step: 0.05 },
      { key: "ai_medium", min: 0, max: 1, step: 0.05 },
      { key: "ai_hard", min: 0, max: 1, step: 0.05 },
      { key: "ai_too_hard", min: 0, max: 1, step: 0.05 },
      { key: "ai_unknown", min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    id: "slots",
    fields: [
      { key: "ur_soft", min: 0, max: 100, step: 1 },
      { key: "ur_strong", min: 0, max: 100, step: 1 },
      { key: "dr_soft", min: 0, max: 100, step: 1 },
      { key: "dr_strong", min: 0, max: 100, step: 1 },
    ],
  },
  {
    id: "winnability",
    fields: [
      { key: "bar_dr_ceiling", min: 1, max: 100, step: 1 },
      { key: "soft_floor", min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    id: "ranking",
    fields: [
      { key: "balance", min: 0, max: 1, step: 0.1 },
      { key: "min_weight", min: 0, max: 0.45, step: 0.05 },
      { key: "shortlist", min: 1, max: 50, step: 1 },
    ],
    curve: true,
  },
];

const CURVES: OpportunityFormula["volume_curve"][] = ["sqrt", "linear", "log"];

export function FormulaEditor({
  value, defaults, onChange, disabled,
}: {
  value: OpportunityFormula;
  /** What each field reverts to — the global when editing a run, the built-in
   *  defaults when editing the global. */
  defaults: OpportunityFormula;
  onChange: (next: OpportunityFormula) => void;
  disabled?: boolean;
}) {
  const { t } = useT();
  const set = (key: keyof OpportunityFormula, v: number | string) =>
    onChange({ ...value, [key]: v } as OpportunityFormula);

  return (
    <div className="space-y-4">
      {GROUPS.map(group => (
        <div key={group.id} className="space-y-2">
          <div>
            <div className="text-sm font-medium">{t.formula.groups[group.id]}</div>
            <div className="text-xs text-slate-600 dark:text-slate-400">
              {t.formula.groupHints[group.id]}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
            {group.fields.map(f => {
              const current = value[f.key] as number;
              const fallback = defaults[f.key] as number;
              const changed = current !== fallback;
              return (
                <label key={f.key} className="text-xs">
                  <span className="block text-slate-600 dark:text-slate-400">
                    {t.formula.labels[f.key] ?? f.key}
                  </span>
                  <span className="flex items-center gap-1.5 mt-0.5">
                    <input
                      type="number"
                      value={current}
                      min={f.min}
                      max={f.max}
                      step={f.step}
                      disabled={disabled}
                      onChange={e => set(f.key, Number(e.target.value))}
                      className={`w-20 px-1.5 py-0.5 rounded border bg-white dark:bg-slate-900 dark:border-slate-700 font-mono ${
                        changed ? "border-amber-500 dark:border-amber-500" : ""
                      }`}
                    />
                    {/* Click to revert one field without resetting the lot. */}
                    {changed && !disabled && (
                      <button
                        type="button"
                        onClick={() => set(f.key, fallback)}
                        title={t.formula.revertTo(String(fallback))}
                        className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      >
                        ↺ {fallback}
                      </button>
                    )}
                  </span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {t.formula.hints[f.key] ?? ""}
                  </span>
                </label>
              );
            })}
          </div>

          {group.curve && (
            <label className="text-xs block">
              <span className="block text-slate-600 dark:text-slate-400">
                {t.formula.labels.volume_curve}
              </span>
              <span className="inline-flex rounded-md border dark:border-slate-700 overflow-hidden mt-0.5">
                {CURVES.map(c => (
                  <button
                    key={c}
                    type="button"
                    disabled={disabled}
                    onClick={() => set("volume_curve", c)}
                    aria-pressed={value.volume_curve === c}
                    className={`px-2 py-0.5 text-xs border-l first:border-l-0 dark:border-slate-700 ${
                      value.volume_curve === c
                        ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                        : "hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t.formula.hints.volume_curve}
              </span>
            </label>
          )}
        </div>
      ))}

      {/* The formula written out, so the fields above are never just knobs. */}
      <div className="text-xs text-slate-500 dark:text-slate-400 font-mono border-t dark:border-slate-800 pt-2">
        {t.formula.equation}
      </div>
    </div>
  );
}

/** Settings-page wrapper: edits the global formula, saves on demand. */
export function GlobalFormulaSection({
  initial, defaults, onSave, onReset,
}: {
  initial: OpportunityFormula;
  defaults: OpportunityFormula;
  onSave: (f: OpportunityFormula) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState<OpportunityFormula>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await onSave(draft);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    try {
      await onReset();
      setDraft(defaults);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <FormulaEditor
        value={draft}
        defaults={defaults}
        onChange={f => { setDraft(f); setSaved(false); }}
        disabled={saving}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 text-sm rounded-md bg-slate-900 text-white dark:bg-white dark:text-slate-900 disabled:opacity-50"
        >
          {t.common.save}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={saving}
          className="px-3 py-1.5 text-sm rounded-md border dark:border-slate-700 disabled:opacity-50"
        >
          {t.formula.resetGlobal}
        </button>
        {saved && <span className="text-xs text-emerald-700 dark:text-emerald-300">{t.common.saved}</span>}
      </div>
    </div>
  );
}
