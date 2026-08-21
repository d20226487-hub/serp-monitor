"use client";
import { useMemo } from "react";
import { useT } from "@/lib/i18n";
import { metricLabel } from "@/lib/metric-labels";
import {
  AnalysisCsvColumn,
  AnalysisCsvGroup,
  CSV_GROUPS,
  CsvColumnOverrides,
  analysisCsvColumns,
  isColumnOn,
  pagesAveragedColumnId,
  pruneOverrides,
} from "@/lib/analysis-csv";

/**
 * Which columns the analyzer CSV carries.
 *
 * The table shows eleven columns; the export has always written twenty-odd,
 * because the diagnostic fields — cohort domains, per-metric page counts, the
 * band split — are the ones you want when auditing a score and exactly the ones
 * that make the sheet unreadable when you are handing a shortlist to someone.
 * So the file starts as what is on screen and the rest is opt-in.
 *
 * Each row names the CSV header next to the human label: the header is what the
 * receiving spreadsheet will actually see, and it does not change with the UI
 * language.
 */
export function CsvColumnPicker({
  metrics, overrides, onChange, onClose,
}: {
  metrics: string[];
  overrides: CsvColumnOverrides;
  onChange: (update: (prev: CsvColumnOverrides) => CsvColumnOverrides) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const columns = useMemo(() => analysisCsvColumns(metrics), [metrics]);
  const selected = columns.filter(c => isColumnOn(c, overrides));

  const byGroup = useMemo(() => {
    const m = new Map<AnalysisCsvGroup, AnalysisCsvColumn[]>();
    for (const c of columns) {
      if (!m.has(c.group)) m.set(c.group, []);
      m.get(c.group)!.push(c);
    }
    return m;
  }, [columns]);

  /** Every change is expressed against the PREVIOUS state rather than against
   *  the `overrides` prop: two ticks landing before React re-renders would
   *  otherwise both build on the same stale map and the first one would be
   *  lost. Overrides are stored pruned, so a selection that happens to match
   *  the defaults is stored as nothing at all. */
  function apply(build: (prev: CsvColumnOverrides) => CsvColumnOverrides) {
    onChange(prev => pruneOverrides(metrics, build(prev)));
  }

  function toggle(col: AnalysisCsvColumn) {
    apply(prev => ({ ...prev, [col.id]: !isColumnOn(col, prev) }));
  }

  /** A group heading is a bulk switch: unticking "SERP shape" is one click
   *  rather than four. All-on flips the group off, anything else fills it. */
  function toggleGroup(group: AnalysisCsvGroup) {
    const cols = byGroup.get(group) ?? [];
    apply(prev => ({
      ...prev,
      ...Object.fromEntries(
        cols.map(c => [c.id, !cols.every(x => isColumnOn(x, prev))]),
      ),
    }));
  }

  function setEvery(on: boolean) {
    apply(() => Object.fromEntries(columns.map(c => [c.id, on])));
  }

  return (
    <div className="px-4 py-3 border-b dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-sm">{t.analysis.csvColumnsTitle}</span>
        <span className="text-xs text-neutral-600 dark:text-neutral-400">
          {t.analysis.csvSelected(selected.length, columns.length)}
        </span>
        <div className="flex items-center gap-1.5 ml-2">
          <button
            type="button"
            onClick={() => setEvery(true)}
            className="px-2 py-0.5 text-xs rounded-md border dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {t.analysis.csvSelectAll}
          </button>
          <button
            type="button"
            onClick={() => setEvery(false)}
            className="px-2 py-0.5 text-xs rounded-md border dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {t.analysis.csvSelectNone}
          </button>
          <button
            type="button"
            onClick={() => onChange(() => ({}))}
            className="px-2 py-0.5 text-xs rounded-md border dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {t.analysis.csvSelectDefault}
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-xs text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          {t.common.close}
        </button>
      </div>

      <p className="text-xs text-neutral-600 dark:text-neutral-400 max-w-3xl">
        {t.analysis.csvColumnsHint}
      </p>

      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {CSV_GROUPS.map(group => {
          const cols = byGroup.get(group) ?? [];
          if (!cols.length) return null;
          const all = cols.every(c => isColumnOn(c, overrides));
          const some = cols.some(c => isColumnOn(c, overrides));
          return (
            <div key={group}>
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                className="flex items-center gap-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 mb-1"
              >
                <span
                  className={`inline-block w-2 h-2 rounded-sm border ${
                    all
                      ? "bg-neutral-900 border-neutral-900 dark:bg-neutral-100 dark:border-neutral-100"
                      : some
                        ? "bg-neutral-400 border-neutral-400 dark:bg-neutral-500 dark:border-neutral-500"
                        : "border-neutral-400 dark:border-neutral-600"
                  }`}
                />
                {t.analysis.csvGroupLabels[group] ?? group}
              </button>
              <ul className="space-y-0.5">
                {cols.map(col => (
                  <li key={col.id}>
                    <label className="flex items-baseline gap-2 text-xs cursor-pointer py-0.5">
                      <input
                        type="checkbox"
                        checked={isColumnOn(col, overrides)}
                        onChange={() => toggle(col)}
                        className="accent-neutral-900 dark:accent-neutral-100 self-center shrink-0"
                      />
                      <span className="text-neutral-800 dark:text-neutral-200 min-w-0">
                        {columnLabel(col, t.analysis)}
                      </span>
                      {/* What the spreadsheet will actually receive. Never
                          truncated — the label beside it is translated, this is
                          the name the receiving sheet will hold. */}
                      <span className="ml-auto pl-2 font-mono text-[11px] text-neutral-500 dark:text-neutral-400 shrink-0">
                        {col.header}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div>
        <div className="text-xs text-neutral-600 dark:text-neutral-400 mb-1">
          {t.analysis.csvHeaderPreview}
        </div>
        {/* The one thing worth checking before downloading: nothing else on
            this panel tells you what order the columns come out in. */}
        <pre className="text-[11px] font-mono whitespace-pre-wrap break-all p-2 rounded border dark:border-neutral-800 bg-white dark:bg-neutral-950 text-neutral-700 dark:text-neutral-300 max-h-24 overflow-y-auto">
          {selected.map(c => c.header).join(",") || "—"}
        </pre>
      </div>
    </div>
  );
}

/** Metric columns borrow the table's own header, so "DR" in the picker is the
 *  "DR" column on screen. Everything else is named in the UI language.
 *
 *  Both metric columns are spelled out rather than left as bare "DR": the pair
 *  is the cohort AVERAGE and the COUNT of pages behind it, and a short label on
 *  either one is read as the other. */
function columnLabel(
  col: AnalysisCsvColumn,
  labels: {
    csvColumnLabels: Record<string, string>;
    csvMetricAverage: (metric: string) => string;
    csvPagesAveraged: (metric: string) => string;
  },
): string {
  if (col.metric) {
    const label = metricLabel(col.metric);
    return col.id === pagesAveragedColumnId(col.metric)
      ? labels.csvPagesAveraged(label)
      : labels.csvMetricAverage(label);
  }
  return labels.csvColumnLabels[col.id] ?? col.header;
}
