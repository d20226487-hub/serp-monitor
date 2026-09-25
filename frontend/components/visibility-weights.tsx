"use client";
import { useEffect, useMemo, useState } from "react";
import { api, VisibilityWeights } from "@/lib/api";
import { useT } from "@/lib/i18n";

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
    <section className="border rounded-md p-4 dark:border-slate-700 space-y-3">
      <h2 className="font-medium">{t.settings.visibility.title}</h2>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        {t.settings.visibility.help}
      </p>

      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <th className="py-1 pr-3 font-medium">{t.settings.visibility.colPosition}</th>
              <th className="py-1 pr-3 font-medium">{t.settings.visibility.colWeight}</th>
              <th className="py-1 pr-3 font-medium">{t.settings.visibility.colShare}</th>
              <th className="py-1 font-medium">{t.settings.visibility.colCumulative}</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row, i) => (
              <tr key={i}>
                <td className="py-0.5 pr-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                  #{i + 1}
                </td>
                <td className="py-0.5 pr-3">
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
                    className="w-20 rounded-md border bg-white px-2 py-1 text-sm font-mono dark:border-slate-700 dark:bg-slate-900"
                  />
                </td>
                <td className="py-0.5 pr-3 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-400">
                  {row.share.toFixed(1)}%
                </td>
                {/* The column that makes the curve legible: "positions 1-3
                    hold 80% of the page between them". */}
                <td className="py-0.5 font-mono text-xs tabular-nums">
                  {row.cumulative.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          disabled={busy || draft.length >= MAX_SLOTS}
          onClick={() => setDraft([...draft, "1"])}
          className="rounded-md border px-2 py-1 disabled:opacity-50 dark:border-slate-700"
        >
          {t.settings.visibility.addSlot}
        </button>
        <button
          type="button"
          disabled={busy || draft.length <= 1}
          onClick={() => setDraft(draft.slice(0, -1))}
          className="rounded-md border px-2 py-1 disabled:opacity-50 dark:border-slate-700"
        >
          {t.settings.visibility.removeSlot}
        </button>
        <span className="text-slate-600 dark:text-slate-400">
          {t.settings.visibility.depth(draft.length)}
        </span>
      </div>

      {!usable && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t.settings.visibility.allZero}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          disabled={busy || !dirty || !usable}
          onClick={save}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
        >{t.common.save}</button>
        <button
          disabled={busy || isDefault}
          onClick={reset}
          className="rounded-md border px-3 py-2 text-sm disabled:opacity-50 dark:border-slate-700"
        >{t.settings.visibility.reset}</button>
        {msg && <span className="text-sm text-emerald-700 dark:text-emerald-300">{msg}</span>}
      </div>

      <p className="text-xs text-slate-600 dark:text-slate-400">
        {t.settings.visibility.footnote}
      </p>
    </section>
  );
}
