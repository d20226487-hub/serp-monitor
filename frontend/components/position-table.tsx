"use client";
import { ProjectPositions, SerpGroup } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { variantLabel } from "@/lib/browser-urls";

/**
 * Where the project's domains rank, one table per SERP.
 *
 * A SERP is the whole of (engine, device, country, language, location, google
 * domain): every one of those changes the page the engine returns, so the same
 * term asked of google.kz in Russian from Almaty and of google.com in Kazakh
 * from Astana are two different results pages holding two different sets of
 * positions. Keeping them in separate tables rather than in one table with a
 * variant column means each table's keyword column reads straight down, and no
 * row can quietly mix two pages together.
 *
 * A blank cell means the domain was not among the positions that run captured —
 * which is "not in the top N scraped", not "not ranking anywhere". The footer
 * says so, because the difference matters when the number goes in a report.
 */
export function PositionTable({ data }: { data: ProjectPositions }) {
  const { t } = useT();
  const { domains } = data.project;

  if (domains.length === 0) {
    return <Empty>{t.positions.noDomains}</Empty>;
  }
  if (data.serps.length === 0) {
    return <Empty>{t.positions.noRuns}</Empty>;
  }

  return (
    <div className="space-y-4">
      {data.serps.map(serp => (
        <SerpTable key={serp.key} serp={serp} domains={domains} />
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="border rounded-md p-6 text-sm text-neutral-600 dark:text-neutral-400 dark:border-neutral-700">
      {children}
    </div>
  );
}

function SerpTable({ serp, domains }: { serp: SerpGroup; domains: string[] }) {
  const { t } = useT();
  // The same label the run page puts beside a browser-check URL, so one SERP is
  // described identically wherever it appears.
  const label = variantLabel(
    {
      engine: serp.engine,
      device: serp.device,
      country_code: serp.country_code,
      language: serp.language,
      location: serp.location,
      google_domain: serp.google_domain,
      yandex_lr: null,
    },
    t.variantLabel,
  );

  return (
    <div className="border rounded-md dark:border-neutral-700 overflow-hidden">
      <div className="px-3 py-2 bg-neutral-50 dark:bg-neutral-900/50 border-b dark:border-neutral-800 flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-sm">{label}</span>
        <span className="text-xs text-neutral-600 dark:text-neutral-400">
          {t.home.kwCount(serp.rows.length)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-neutral-800">
              <th className="px-3 py-2 font-medium">{t.positions.colKeyword}</th>
              {domains.map(d => (
                <th key={d} className="px-3 py-2 font-medium text-right font-mono text-xs">
                  {d}
                </th>
              ))}
              <th className="px-3 py-2 font-medium text-right">{t.positions.colChecked}</th>
            </tr>
          </thead>
          <tbody>
            {serp.rows.map(r => (
              <tr key={r.keyword} className="border-b last:border-b-0 dark:border-neutral-800">
                <td className="px-3 py-2 font-medium break-all">{r.keyword}</td>
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
