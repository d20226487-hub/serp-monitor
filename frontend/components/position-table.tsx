"use client";
import { ProjectPositions } from "@/lib/api";
import { useT } from "@/lib/i18n";

/**
 * Where the project's domains rank, keyword by keyword.
 *
 * Rows are one keyword in one SERP VARIANT, not one keyword: the same term on
 * mobile in Almaty and on desktop in Astana are different SERPs holding
 * genuinely different positions, and one row averaging them would show a
 * number no page ever held. The variant columns only appear when the project
 * actually spans more than one, so the common single-market case stays a plain
 * keyword × domain grid.
 *
 * A blank cell means the domain was not in the results that run captured —
 * which is "not in the top N scraped", not "not ranking anywhere". The footer
 * says so, because the difference matters when the number is going in a report.
 */
export function PositionTable({ data }: { data: ProjectPositions }) {
  const { t } = useT();
  const { domains } = data.project;

  if (domains.length === 0) {
    return (
      <div className="border rounded-md p-6 text-sm text-neutral-600 dark:text-neutral-400 dark:border-neutral-700">
        {t.positions.noDomains}
      </div>
    );
  }
  if (data.rows.length === 0) {
    return (
      <div className="border rounded-md p-6 text-sm text-neutral-600 dark:text-neutral-400 dark:border-neutral-700">
        {t.positions.noRuns}
      </div>
    );
  }

  return (
    <div className="border rounded-md dark:border-neutral-700 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 dark:bg-neutral-900/50">
            <tr className="text-left border-b dark:border-neutral-800">
              <th className="px-3 py-2 font-medium">{t.positions.colKeyword}</th>
              {data.multi_variant && (
                <th className="px-3 py-2 font-medium">{t.positions.colVariant}</th>
              )}
              {domains.map(d => (
                <th key={d} className="px-3 py-2 font-medium text-right font-mono text-xs">
                  {d}
                </th>
              ))}
              <th className="px-3 py-2 font-medium text-right">{t.positions.colChecked}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map(r => (
              <tr
                key={`${r.keyword}|${r.engine}|${r.device}|${r.location ?? ""}`}
                className="border-b last:border-b-0 dark:border-neutral-800"
              >
                <td className="px-3 py-2 font-medium break-all">{r.keyword}</td>
                {data.multi_variant && (
                  <td className="px-3 py-2 text-xs text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                    {[r.engine, r.device, r.location].filter(Boolean).join(" · ")}
                  </td>
                )}
                {domains.map(d => {
                  const cell = r.positions[d];
                  return (
                    <td key={d} className="px-3 py-2 text-right tabular-nums">
                      {cell ? (
                        <a
                          href={cell.url ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                          title={cell.url ?? undefined}
                          className={`font-medium hover:underline ${
                            cell.position <= 3
                              ? "text-emerald-700 dark:text-emerald-300"
                              : cell.position <= 10
                                ? "text-neutral-900 dark:text-neutral-100"
                                : "text-neutral-600 dark:text-neutral-400"
                          }`}
                        >
                          {cell.position}
                        </a>
                      ) : (
                        <span className="text-neutral-400 dark:text-neutral-600">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right text-xs text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                  {/* The run this row's numbers came from, so a stale row in a
                      wide window is visible as stale rather than as current. */}
                  <a href={`/runs/${r.run_id}`} className="hover:underline">
                    {new Date(r.checked_at).toLocaleString()}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-2 border-t dark:border-neutral-800 text-xs text-neutral-600 dark:text-neutral-400">
        {t.positions.footnote}
      </div>
    </div>
  );
}
