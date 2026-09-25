"use client";
import { useEffect, useMemo, useState } from "react";
import { api, VisibilityWeights } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button, Callout, Card, Pill, SectionTitle, inputClass } from "@/components/ui";
import { Icon } from "@/components/icons";

/**
 * What each SERP slot is worth, as a share of the page.
 *
 * This is the curve behind the Visibility column on a project's averaged
 * positions. It is configuration rather than code for the same reason the
 * opportunity formula is: how much more #1 is worth than #3 is a judgement
 * about a market, and a branded query and a research query do not agree.
 *
 * The weights are relative. Every score divides by the weight in play on the
 * page being measured, so entering 5/2/1 says the same thing as 50/20/10 —
 * which is why the editor shows the share and the running total beside each
 * row rather than asking anyone to make the column add up to a hundred.
 *
 * The length of the list is also the setting: a slot past the last row is
 * worth nothing, so the curve decides how far down a page counts as visible
 * at all.
 */

/** Server cap. Past this a slot weight is not saying anything useful. */
const MAX_SLOTS = 50;

export function VisibilitySection({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useT();
  const [data, setData] = useState<VisibilityWeights | null>(null);
  // Held as text so a half-typed field can be empty without snapping to 0.
  const [draft, setDraft] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function adopt(next: VisibilityWeights) {
    setData(next);
    setDraft(next.weights.map(String));
  }

  useEffect(() => {
    api.getVisibility().then(adopt).catch(e => onError(e?.message ?? "Failed to load"));
  }, []);

  // Previewed here rather than round-tripping: the point of the column is to
  // see what a change does before committing to it.
  const view = useMemo(() => {
    const weights = draft.map(v => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let running = 0;
    const rows = weights.map(w => {
      const shareOf = total > 0 ? (w * 100) / total : 0;
      running += shareOf;
      return { weight: w, share: shareOf, cumulative: running };
    });
    return { weights, total, rows };
  }, [draft]);

  const dirty =
    !!data && JSON.stringify(view.weights) !== JSON.stringify(data.weights);
  const isDefault =
    !!data && JSON.stringify(data.weights) === JSON.stringify(data.defaults);
  const usable = view.total > 0 && view.weights.length > 0;

  async function save() {
    setBusy(true); setMsg(null); onError(null);
    try {
      adopt(await api.setVisibility(view.weights));
      setMsg(t.common.saved);
    } catch (e: any) {
      onError(e?.message ?? "Save failed");
    } finally { setBusy(false); }
  }

  async function reset() {
    setBusy(true); setMsg(null); onError(null);
    try {
      adopt(await api.resetVisibility());
      setMsg(t.common.saved);
    } catch (e: any) {
      onError(e?.message ?? "Reset failed");
    } finally { setBusy(false); }
  }

  if (!data) return null;

  return (
    <Card
      title={<SectionTitle icon="value">{t.settings.visibility.title}</SectionTitle>}
      actions={
        isDefault
          ? <Pill tone="neutral" icon="dash">{t.settings.visibility.isDefault}</Pill>
          : <Pill tone="info" icon="pencil">{t.settings.visibility.customised}</Pill>
      }
    >
      <div className="space-y-4">
      <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        {t.settings.visibility.help}
      </p>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
              <th className="px-3 py-2 font-medium">{t.settings.visibility.colPosition}</th>
              <th className="px-3 py-2 font-medium">{t.settings.visibility.colWeight}</th>
              <th className="px-3 py-2 font-medium">{t.settings.visibility.colShare}</th>
              <th className="px-3 py-2 font-medium">{t.settings.visibility.colCumulative}</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row, i) => (
              <tr
                key={i}
                className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
              >
                <td className="px-3 py-1 font-mono text-xs text-slate-500 dark:text-slate-400">
                  #{i + 1}
                </td>
                <td className="px-3 py-1">
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={draft[i]}
                    onChange={e => {
                      const next = [...draft];
                      next[i] = e.target.value;
                      setDraft(next);
                    }}
                    className={`${inputClass} !w-24 font-mono`}
                  />
                </td>
                <td className="px-3 py-1 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-400">
                  {row.share.toFixed(1)}%
                </td>
                {/* The column that makes the curve legible: "positions 1-3
                    hold 80% of the page between them". */}
                <td className="px-3 py-1 font-mono text-xs font-semibold tabular-nums">
                  {row.cumulative.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Button
          size="sm"
          disabled={busy || draft.length >= MAX_SLOTS}
          onClick={() => setDraft([...draft, "1"])}
        >
          {t.settings.visibility.addSlot}
        </Button>
        <Button
          size="sm"
          disabled={busy || draft.length <= 1}
          onClick={() => setDraft(draft.slice(0, -1))}
        >
          {t.settings.visibility.removeSlot}
        </Button>
        <span className="text-slate-600 dark:text-slate-400">
          {t.settings.visibility.depth(draft.length)}
        </span>
      </div>

      {!usable && (
        <Callout tone="warn" icon="alert">{t.settings.visibility.allZero}</Callout>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy || !dirty || !usable} onClick={save}>
          {t.common.save}
        </Button>
        <Button disabled={busy || isDefault} onClick={reset}>
          {t.settings.visibility.reset}
        </Button>
        {msg && (
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
            <Icon name="check" className="h-3.5 w-3.5" />
            {msg}
          </span>
        )}
      </div>

      <p className="text-xs text-slate-600 dark:text-slate-400">
        {t.settings.visibility.footnote}
      </p>
      </div>
    </Card>
  );
}
