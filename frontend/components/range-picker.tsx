"use client";
import { useT } from "@/lib/i18n";
import { RANGE_PRESETS, RangePreset } from "@/lib/date-range";

/**
 * The period chips — Today, Yesterday, This week … Custom — with the two date
 * fields of a custom range. Holds no state of its own: two of them bound to
 * the same values are one choice shown twice (user, 2026-10-29, on a second
 * one under the Position Tracking table: "These date widgets should be in
 * sync").
 */
export function RangePicker({ preset, onPreset, from, onFrom, to, onTo, className = "" }: {
  preset: RangePreset;
  onPreset: (p: RangePreset) => void;
  from: string;
  onFrom: (v: string) => void;
  to: string;
  onTo: (v: string) => void;
  className?: string;
}) {
  const { t } = useT();
  const DATE = "rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
        {RANGE_PRESETS.map(p => (
          <button
            key={p}
            type="button"
            onClick={() => onPreset(p)}
            aria-pressed={preset === p}
            className={`border-l px-2.5 py-1 text-xs transition first:border-l-0 dark:border-slate-700 ${
              preset === p
                ? "bg-slate-900 font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            {t.positions.presets[p]}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <span className="inline-flex items-center gap-1.5 text-xs">
          <input type="date" value={from} onChange={e => onFrom(e.target.value)} className={DATE} />
          <span className="text-slate-500 dark:text-slate-400">–</span>
          <input type="date" value={to} onChange={e => onTo(e.target.value)} className={DATE} />
        </span>
      )}
    </div>
  );
}
