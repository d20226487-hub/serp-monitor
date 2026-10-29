"use client";
import { useEffect, useMemo, useState } from "react";
import type { ProjectTracking, TrackingRow } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui";
import { Icon } from "@/components/icons";
import { DateRange, toInputValue } from "@/lib/date-range";
import { ChangeKind, Compare, serpExtras } from "@/lib/position-tracking";
import {
  Band, CsvWords, EVERYTHING, ExportChoice, bandStart, exportRows, toCsv, trackingTable,
} from "@/lib/tracking-export";

/**
 * Position Tracking's export (user, 2026-10-29): "Экспорт CSV" downloads the
 * whole table — every URL the table can show, whatever its filters, in its
 * order — and the arrow beside it opens a choice: GEO with its search engines
 * under it, the position bands (Топ 1 = #1, Топ 3 = #2–3 … several at once)
 * and the kinds of change. The choice opens below the toolbar, on a line of
 * its own; the button sits at the end of the toolbar.
 */

const KINDS: ChangeKind[] = ["up", "down", "same", "new", "lost", "none"];
const BOX = "flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800";
const LEGEND = "mb-1 text-xs font-medium text-slate-500 dark:text-slate-400";

const toggled = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

export function TrackingExport({ data, compare, order, since, range }: {
  data: ProjectTracking;
  /** What the change is measured against: the table's "Compare with". */
  compare: Compare;
  /** The table's order, for the file. */
  order: (rows: TrackingRow[]) => TrackingRow[];
  /** The previous period, as the table names it. */
  since: string;
  range: DateRange | null;
}) {
  const { t, lang } = useT();
  const x = t.positions.tracking;
  const [open, setOpen] = useState(false);
  const allSerps = useMemo(() => data.serps.map(s => s.key), [data]);
  const allBands = useMemo<Band[]>(() => [...data.thresholds, "none"], [data]);
  const [serps, setSerps] = useState<string[]>(allSerps);
  const [bands, setBands] = useState<Band[]>(allBands);
  const [changes, setChanges] = useState<ChangeKind[]>(KINDS);
  // Another period can bring other SERPs: start from all of them again.
  useEffect(() => { setSerps(allSerps); }, [allSerps]);

  const serpByKey = useMemo(() => new Map(data.serps.map(s => [s.key, s])), [data]);
  const geos = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const s of data.serps) {
      const geo = (s.country_code ?? "—").toUpperCase();
      out.set(geo, [...(out.get(geo) ?? []), s.key]);
    }
    return [...out.entries()];
  }, [data]);

  const choice: ExportChoice = {
    serps: serps.length === allSerps.length ? null : serps,
    bands: bands.length === allBands.length ? null : bands,
    changes: changes.length === KINDS.length ? null : changes,
  };
  const picked = exportRows(data.rows, choice, compare, data.thresholds);


  function download(rows: TrackingRow[]) {
    const words: CsvWords = {
      head: x.csvHead,
      engine: e => t.variantLabel[e as "google" | "yandex"] ?? e,
      kind: k => x.changeRow[k],
    };
    const table = trackingTable(order(rows), lang, compare, r => serpByKey.get(r.serp), words);
    const name = data.project.name.trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase() || "project";
    const period = range
      ? `_${toInputValue(range.start)}_${toInputValue(new Date(range.end.getTime() - 1))}`
      : "";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([toCsv(table, lang)], { type: "text/csv;charset=utf-8" }));
    link.download = `${name}_position-tracking${period}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  return (
    <>
      <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
        <button
          type="button"
          onClick={() => download(exportRows(data.rows, EVERYTHING, compare, data.thresholds))}
          title={x.exportHint}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Icon name="download" className="h-3.5 w-3.5" />
          {x.export}
        </button>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-label={x.exportOptions}
          title={x.exportOptions}
          className="border-l border-slate-300 px-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Icon name="chevronDown" className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <div className="w-full rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <div className="grid gap-4 sm:grid-cols-3">
            <fieldset>
              <legend className={LEGEND}>{x.exportGeoEngine}</legend>
              <div className="space-y-1.5">
                {geos.map(([geo, keys]) => {
                  const all = keys.every(k => serps.includes(k));
                  const some = keys.some(k => serps.includes(k));
                  return (
                    <div key={geo}>
                      <label className={`${BOX} font-medium`}>
                        <input
                          type="checkbox"
                          checked={all}
                          ref={el => { if (el) el.indeterminate = some && !all; }}
                          onChange={() => setSerps(all ? serps.filter(k => !keys.includes(k)) : [...new Set([...serps, ...keys])])}
                        />
                        <span className="font-mono">{geo}</span>
                      </label>
                      <div className="ml-5">
                        {keys.map(k => {
                          const s = serpByKey.get(k)!;
                          const extras = serpExtras(s, data.serps);
                          return (
                            <label key={k} className={BOX}>
                              <input type="checkbox" checked={serps.includes(k)} onChange={() => setSerps(toggled(serps, k))} />
                              {t.variantLabel[s.engine as "google" | "yandex"] ?? s.engine}
                              {extras.length > 0 && <span className="text-xs text-slate-500 dark:text-slate-400">{extras.join(" · ")}</span>}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </fieldset>
            <fieldset>
              <legend className={LEGEND}>{x.exportPosition}</legend>
              {data.thresholds.map(n => (
                <label key={n} className={BOX}>
                  <input type="checkbox" checked={bands.includes(n)} onChange={() => setBands(toggled(bands, n))} />
                  {x.exportBand(n, bandStart(n, data.thresholds))}
                </label>
              ))}
              <label className={BOX}>
                <input type="checkbox" checked={bands.includes("none")} onChange={() => setBands(toggled<Band>(bands, "none"))} />
                {x.exportNone}
              </label>
            </fieldset>
            <fieldset>
              <legend className={LEGEND}>{x.exportChange}</legend>
              {KINDS.map(k => (
                <label key={k} className={BOX}>
                  <input type="checkbox" checked={changes.includes(k)} onChange={() => setChanges(toggled(changes, k))} />
                  {x.changeKinds[k]}
                </label>
              ))}
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {x.exportCompare(compare === "check" ? x.compareCheck : `${x.comparePeriod}${since ? ` (${since})` : ""}`)}
              </p>
            </fieldset>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3 dark:border-slate-800">
            <span className="text-sm text-slate-700 dark:text-slate-300">{x.exportCount(picked.length)}</span>
            <Button size="sm" variant="primary" disabled={picked.length === 0} onClick={() => download(picked)}>
              <Icon name="download" className="h-3.5 w-3.5" />
              {x.exportDownload}
            </Button>
            <button
              type="button"
              onClick={() => { setSerps(allSerps); setBands(allBands); setChanges(KINDS); }}
              className="text-xs underline underline-offset-2"
            >
              {x.exportReset}
            </button>
            {/* Everything off but the first GEO's first search engine, to pick
                from there (user, 2026-10-29: "Очистить все which will unselect
                all the options besides the first GEO + поисковик"). */}
            <button
              type="button"
              onClick={() => { setSerps(geos.length ? [geos[0][1][0]] : []); setBands([]); setChanges([]); }}
              className="text-xs underline underline-offset-2"
            >
              {x.exportClear}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
