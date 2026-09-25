"use client";
import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { parseVolumePaste } from "@/lib/volume-paste";

/**
 * Bulk volume entry: paste an Ahrefs export, review, apply.
 *
 * The review step is the point. A paste is the one place a single typo can
 * rewrite ten scores at once, so nothing is written until the parse is shown
 * back — which column was read as the volume, what matched, what did not, and
 * which keywords are still without a figure.
 */
export function VolumePastePanel({
  runKeywords, market, onApply, onClose,
}: {
  runKeywords: string[];
  /** The run's market, uppercased — Ahrefs volumes are per country, so a paste
   *  from another country is a real and easy mistake to make. */
  market: string;
  onApply: (rows: { keyword: string; volume: number }[]) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const parsed = useMemo(
    () => parseVolumePaste(text, runKeywords),
    [text, runKeywords],
  );

  // Ahrefs exports carry the country they were pulled for. If every row says
  // "us" and this run is KZ, the numbers are for the wrong market entirely.
  const wrongCountry =
    market &&
    parsed.countries.length > 0 &&
    !parsed.countries.includes(market.toLowerCase());

  async function apply() {
    setSaving(true);
    try {
      await onApply(parsed.matched);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 py-3 border-b dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="font-medium text-sm">{t.analysis.pasteTitle}</span>
        <span className="text-xs text-slate-600 dark:text-slate-400">{t.analysis.pasteHelp(market)}</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
        >
          {t.common.cancel}
        </button>
      </div>

      <textarea
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={t.analysis.pastePlaceholder}
        rows={6}
        className="w-full px-2 py-1.5 text-xs font-mono rounded border bg-white dark:bg-slate-900 dark:border-slate-700"
      />

      {text.trim() && (
        <div className="text-xs space-y-1">
          {/* Which column was read as the volume — the one thing most worth
              checking before applying, since Ahrefs rows carry several
              numbers and only one of them is the search volume. */}
          {parsed.header ? (
            <div className="text-slate-600 dark:text-slate-300">
              {t.analysis.pasteColumns(parsed.header.keyword, parsed.header.volume)}
            </div>
          ) : (
            <div className="text-slate-600 dark:text-slate-400">{t.analysis.pasteNoHeader}</div>
          )}

          {wrongCountry && (
            <div className="text-amber-700 dark:text-amber-300">
              {t.analysis.pasteWrongCountry(
                parsed.countries.join(", ").toUpperCase(), market,
              )}
            </div>
          )}

          <div className="text-emerald-700 dark:text-emerald-300">
            {t.analysis.pasteMatched(parsed.matched.length)}
          </div>

          {parsed.unmatched.length > 0 && (
            <div className="text-amber-700 dark:text-amber-300">
              {t.analysis.pasteUnmatched(
                parsed.unmatched.length,
                parsed.unmatched.slice(0, 5).map(u => u.keyword).join(", ")
                  + (parsed.unmatched.length > 5 ? "…" : ""),
              )}
            </div>
          )}

          {parsed.skipped.length > 0 && (
            <div className="text-slate-600 dark:text-slate-400">
              {t.analysis.pasteSkipped(parsed.skipped.length)}
            </div>
          )}

          {parsed.missing.length > 0 && (
            <div className="text-slate-600 dark:text-slate-400">
              {t.analysis.pasteMissing(
                parsed.missing.length,
                parsed.missing.slice(0, 5).join(", ")
                  + (parsed.missing.length > 5 ? "…" : ""),
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={apply}
          disabled={saving || parsed.matched.length === 0}
          className="px-3 py-1 text-xs rounded-md bg-slate-900 text-white dark:bg-white dark:text-slate-900 disabled:opacity-40"
        >
          {saving
            ? t.common.loading
            : t.analysis.pasteApply(parsed.matched.length)}
        </button>
      </div>
    </div>
  );
}
