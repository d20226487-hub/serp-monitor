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
 * from Astana are two different results pages. Separate tables rather than a
 * variant column means each table's keyword column reads straight down, and no
 * row can quietly mix two pages together.
 *
 * Within a table, a row lists what ranked, in position order — it does NOT
 * give every project domain a column. A project watching ten sites would be a
 * ten-column grid of mostly dashes, and a keyword where all ten rank reads far
 * better as "1 · 2 · 4 · 9 …" in order than as ten columns the eye has to
 * reassemble. It also keeps the row honest about what is being claimed: only
 * measured positions appear.
 *
 * An empty row means no project domain was among the positions that run
 * captured — which is "not in the top N scraped", not "not ranking anywhere".
 */
export function PositionTable({ data }: { data: ProjectPositions }) {
  const { t } = useT();

  if (data.project.domains.length === 0) return <Empty>{t.positions.noDomains}</Empty>;
  if (data.serps.length === 0) return <Empty>{t.positions.noRuns}</Empty>;

  return (
    <div className="space-y-4">
      {data.serps.map(serp => <SerpTable key={serp.key} serp={serp} />)}
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

/** Green in the top 3, plain to the bottom of page one, muted past it — the
 *  three bands anyone reading a position actually thinks in. */
function positionTone(position: number): string {
  if (position <= 3) return "bg-emerald-100 text-emerald-900 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-900";
  if (position <= 10) return "bg-neutral-100 text-neutral-900 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-700";
  return "bg-transparent text-neutral-600 border-neutral-200 dark:text-neutral-400 dark:border-neutral-700";
}

function SerpTable({ serp }: { serp: SerpGroup }) {
  const { t } = useT();
  // The same label the run page puts beside a browser-check URL, so one SERP
  // is described identically wherever it appears.
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
  const ranking = serp.rows.filter(r => r.hits.length > 0).length;

  return (
    <div className="border rounded-md dark:border-neutral-700 overflow-hidden">
      <div className="px-3 py-2 bg-neutral-50 dark:bg-neutral-900/50 border-b dark:border-neutral-800 flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-sm">{label}</span>
        <span className="text-xs text-neutral-600 dark:text-neutral-400">
          {t.positions.ranking(ranking, serp.rows.length)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-neutral-800">
              <th className="px-3 py-2 font-medium w-64">{t.positions.colKeyword}</th>
              <th className="px-3 py-2 font-medium">{t.positions.colOurPositions}</th>
              <th className="px-3 py-2 font-medium text-right whitespace-nowrap">
                {t.positions.colChecked}
              </th>
            </tr>
          </thead>
          <tbody>
            {serp.rows.map(r => (
              <tr key={r.keyword} className="border-b last:border-b-0 dark:border-neutral-800 align-top">
                <td className="px-3 py-2 font-medium break-all">{r.keyword}</td>
                <td className="px-3 py-2">
                  {r.hits.length === 0 ? (
                    <span className="text-neutral-400 dark:text-neutral-600">
                      {t.positions.notRanking}
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {r.hits.map(h => (
                        <a
                          key={h.domain}
                          href={h.url ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                          title={h.url ?? undefined}
                          className={`inline-flex items-baseline gap-1.5 px-2 py-0.5 rounded-full border text-xs hover:underline ${positionTone(h.position)}`}
                        >
                          <span className="font-semibold tabular-nums">{h.position}</span>
                          <span className="font-mono">{h.domain}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </td>
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
