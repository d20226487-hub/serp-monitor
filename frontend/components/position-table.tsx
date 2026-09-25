"use client";
import { useState } from "react";
import { ProjectPositions, SerpGroup } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { variantLabel } from "@/lib/browser-urls";
import { Empty as KitEmpty, positionTone, TONE_PILL } from "@/components/ui";
import { Icon } from "@/components/icons";

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
 *
 * Where a job asked for it, a hit is credited to the host the engine DISPLAYED
 * rather than the one the link opens — an AMP or CDN result belongs to its
 * publisher. Those hits are marked, and the raw host is one click away: the
 * same field a publisher uses honestly is the one a doorway spoofs, so the
 * substitution must never be silent.
 */
export function PositionTable({ data }: { data: ProjectPositions }) {
  const { t } = useT();
  // Off by default, as asked: the resolved host is the answer, the raw one is
  // the evidence behind it.
  const [showRaw, setShowRaw] = useState(false);

  if (data.project.domains.length === 0) return <KitEmpty>{t.positions.noDomains}</KitEmpty>;
  if (data.serps.length === 0) return <KitEmpty>{t.positions.noRuns}</KitEmpty>;

  const substituted = data.serps.reduce(
    (n, s) => n + s.rows.reduce((m, r) => m + r.hits.filter(h => h.substituted).length, 0),
    0,
  );

  // One block per engine. Google and Yandex are different products with
  // different result sets, so reading them as one run-on stack of tables makes
  // the reader keep track of which is which; a heading does that instead.
  // Alphabetical, so the order never moves between visits.
  const byEngine = new Map<string, typeof data.serps>();
  for (const serp of data.serps) {
    const list = byEngine.get(serp.engine);
    if (list) list.push(serp);
    else byEngine.set(serp.engine, [serp]);
  }
  const engines = [...byEngine.keys()].sort();

  return (
    <div className="space-y-10">
      {substituted > 0 && (
        <label className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <input
            type="checkbox"
            checked={showRaw}
            onChange={e => setShowRaw(e.target.checked)}
            className="accent-amber-600"
          />
          <Icon name="alert" className="h-3.5 w-3.5" />
          {t.positions.showRaw(substituted)}
        </label>
      )}
      {engines.map(engine => (
        <section key={engine} className="space-y-4">
          <h3 className="flex items-center gap-2 border-b border-slate-200 pb-2 text-lg font-semibold tracking-tight dark:border-slate-800">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
              <Icon name="globe" className="h-4 w-4" />
            </span>
            {engine === "yandex" ? t.variantLabel.yandex : t.variantLabel.google}
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
              {t.positions.serpCount((byEngine.get(engine) ?? []).length)}
            </span>
          </h3>
          {/* Roomier than the gap inside a table so the eye groups these as
              one engine's set rather than as unrelated blocks. */}
          <div className="space-y-6">
            {(byEngine.get(engine) ?? []).map(serp => (
              <SerpTable key={serp.key} serp={serp} showRaw={showRaw} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SerpTable({ serp, showRaw }: { serp: SerpGroup; showRaw: boolean }) {
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
    <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/60">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
          <Icon name="globe" className="h-3.5 w-3.5" />
        </span>
        <span className="text-sm font-semibold tracking-tight">{label}</span>
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {t.positions.ranking(ranking, serp.rows.length)}
        </span>
        {/* The paragraph that used to sit under every table. It explains how a
            row is chosen and what an empty one means — worth having, not worth
            repeating beneath each of four tables. */}
        <button
          type="button"
          title={t.positions.footnote}
          aria-label={t.positions.footnote}
          className="ml-auto text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200"
        >
          <Icon name="info" className="h-4 w-4" />
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <th className="w-64 px-3 py-2 font-medium">{t.positions.colKeyword}</th>
              <th className="px-3 py-2 font-medium">{t.positions.colOurPositions}</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                {t.positions.colChecked}
              </th>
            </tr>
          </thead>
          <tbody>
            {serp.rows.map(r => (
              <tr
                key={r.keyword}
                className="border-b border-slate-100 align-top last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
              >
                {/* break-words, not break-all: a keyword is language, and breaking
                    "boostwin казино" mid-syllable is unreadable. Long unbroken
                    strings still wrap, they just are not cut at an arbitrary
                    character when a space would do. */}
                <td className="break-words px-3 py-2.5 text-sm font-medium">{r.keyword}</td>
                <td className="px-3 py-2">
                  {r.hits.length === 0 ? (
                    <span className="text-xs text-slate-400 dark:text-slate-500">
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
                          title={
                            h.substituted
                              ? t.positions.substitutedHint(h.shown_host ?? "", h.linked_host ?? "")
                              : h.url ?? undefined
                          }
                          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs transition hover:underline ${TONE_PILL[positionTone(h.position)]}`}
                        >
                          <span className="font-semibold tabular-nums">{h.position}</span>
                          <span className="font-mono">{h.domain}</span>
                          {/* Marked even when the raw host is hidden: a reader
                              must be able to see that a substitution happened
                              without having to go looking for it. */}
                          {h.substituted && (
                            <span
                              aria-label={t.positions.substituted}
                              className="text-amber-700 dark:text-amber-400"
                            >
                              ⇄
                            </span>
                          )}
                          {/* Asked to resolve, nothing to resolve with. Shown
                              so a fallback to the raw link never passes for a
                              resolved one. */}
                          {h.unresolved && (
                            <span
                              title={t.positions.unresolvedHint}
                              className="text-slate-500 dark:text-slate-400"
                            >
                              ?
                            </span>
                          )}
                          {h.substituted && showRaw && (
                            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              → {h.linked_host}
                            </span>
                          )}
                        </a>
                      ))}
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs text-slate-500 dark:text-slate-400">
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
    </div>
  );
}
