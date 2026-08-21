"use client";
import { useEffect, useMemo, useState } from "react";
import { AnalysisDomain, AnalysisRow, AnalysisUrl, JobRun, RunAnalysis } from "@/lib/api";
import { Lang, messagesFor } from "@/lib/i18n";
import {
  Depth,
  bandCounts,
  cohortAverage,
  cohortSizeFor,
  ladderDriver,
  weakestCohort,
  weaknessRanker,
  withinDepth,
} from "@/lib/serp-strength";
import { OpportunityFormula, scoreRow, maxVolumeOf } from "@/lib/opportunity";
import { downloadReportPdf } from "@/lib/report-pdf";

/**
 * A printable report for one run, led by the opportunity shortlist.
 *
 * Deliberately a document rather than slides: the useful content here is
 * tabular — a ranked list and per-keyword competitor tables — and tables do not
 * survive being cut into 16:9 panels. Ctrl+P against the print stylesheet
 * gives a clean PDF with no extra dependency.
 *
 * Its language is chosen here rather than inherited from the app toggle: the
 * report is produced for a Russian-speaking reader whoever generated it.
 */

/**
 * The entry bar expressed in referring domains, read off the DOMAIN-level
 * metrics rather than the page-level ones.
 *
 * A doorway ranks on a page with no links of its own, so its page figure is 0
 * and tells the reader nothing about what it would take to displace it. The
 * referring domains behind the SITE are the number that has to be matched, and
 * they are the number a client recognises — "we need links from ~30 domains"
 * is a brief, "DR 25" is a rating they have to take on trust.
 *
 * The mean of the same cohort the DR bar averages, so both bars describe the
 * same competitors and both answer "the weakest N here look like this".
 * cohortSizeFor picks that N from how many results came back: two below seven,
 * three at seven or more. weakestCohort keeps one page per domain, so no site
 * can weight the average twice.
 *
 * Worth knowing when reading it: unlike DR, referring domains are unbounded,
 * so one heavily-linked member pulls the mean well above the others. On the
 * "vavada" SERP the cohort carried 0, 17 and 3084 and the bar reads 1034.
 */
function cohortRefdomains(row: AnalysisRow, cohort: AnalysisUrl[]): number | null {
  const byDomain = new Map(row.domains.map(d => [d.domain, d]));
  const found = cohort
    .map(u => byDomain.get(u.domain)?.metrics.refdomains_dofollow)
    .filter((v): v is number => v != null);
  // Domain metrics are a separate job switch from page metrics, so a run can
  // legitimately have none. Blank beats a fabricated zero.
  if (!found.length) return null;
  return found.reduce((a, b) => a + b, 0) / found.length;
}

const HIDE_KEY = (runId: number) => `report:${runId}:hiddenDomains`;
const KW_KEY = (runId: number) => `report:${runId}:keywords`;

/** Domains that are almost never the competitor being discussed — they are the
 *  brand's own socials, or encyclopaedic results nobody is displacing. Only a
 *  default: every one of them can be ticked back on. */
const NOISE = [
  "youtube.com", "instagram.com", "facebook.com", "wikipedia.org",
  "apple.com", "google.com", "play.google.com", "x.com", "twitter.com",
  "linkedin.com", "t.me", "telegram.org",
];

function isNoise(domain: string): boolean {
  return NOISE.some(n => domain === n || domain.endsWith(`.${n}`));
}

function formatAge(days: number | null | undefined): string {
  if (days == null) return "—";
  if (days < 31) return `${days} d`;
  if (days < 365) return `${Math.floor(days / 30)} mo`;
  const y = days / 365.25;
  return y < 10 ? `${y.toFixed(1)} y` : `${y.toFixed(0)} y`;
}

function num(v: number | null | undefined): string {
  return v == null ? "—" : v.toLocaleString();
}

/** Filesystem-safe filename stem. Cyrillic job names are transliterated away
 *  rather than left to whatever the browser does with them on download. */
function slugify(name: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh",
    щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return (name || "")
    .toLowerCase()
    .split("")
    .map(ch => (ch in map ? map[ch] : ch))
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function RunReport({
  analysis, run, jobName, depth,
}: {
  analysis: RunAnalysis;
  run: JobRun | null;
  jobName: string;
  depth: Depth;
}) {
  const [lang, setLang] = useState<Lang>("ru");
  const t = messagesFor(lang);
  const runId = run?.id ?? 0;

  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<Set<string> | null>(null);

  const formula: OpportunityFormula = analysis.formula;

  // Every keyword that can be ranked at all, best first. A keyword with no
  // volume has no score, so it cannot be placed in a shortlist and is left out
  // rather than shown at the bottom as though it were worst.
  const ranked = useMemo(() => {
    const maxVolume = maxVolumeOf(analysis.rows);
    return analysis.rows
      .map(row => {
        const inDepth = withinDepth(row.urls, depth);
        const cohort = weakestCohort(
          inDepth, weaknessRanker(analysis.metrics), cohortSizeFor(inDepth.length),
        );
        return {
          row,
          inDepth,
          // Counted directly rather than reversed out of the soft-slot factor:
          // that reversal divides by (1 - soft_floor), which is zero when the
          // factor is configured off, and would report every SERP as having no
          // soft slots at all.
          bands: bandCounts(inDepth, ladderDriver(analysis.metrics), formula),
          cohortDr: cohortAverage(cohort, "domain_rating").value,
          cohortRd: cohortRefdomains(row, cohort),
          opp: scoreRow(row, depth, analysis.metrics, maxVolume, formula.balance, formula),
        };
      })
      .filter(v => v.opp.score != null)
      .sort((a, b) => (b.opp.score as number) - (a.opp.score as number));
  }, [analysis.rows, analysis.metrics, depth, formula]);

  // Default selection: the shortlist. Restored from the last visit if there
  // was one, so a report tuned for a client survives a reload.
  useEffect(() => {
    try {
      const savedKw = localStorage.getItem(KW_KEY(runId));
      const savedHidden = localStorage.getItem(HIDE_KEY(runId));
      if (savedHidden) setHidden(new Set(JSON.parse(savedHidden)));
      if (savedKw) { setChosen(new Set(JSON.parse(savedKw))); return; }
    } catch {}
    setChosen(new Set(ranked.slice(0, formula.shortlist).map(v => v.row.keyword)));
  }, [runId, ranked, formula.shortlist]);

  function persist(kw: Set<string>, hide: Set<string>) {
    try {
      localStorage.setItem(KW_KEY(runId), JSON.stringify([...kw]));
      localStorage.setItem(HIDE_KEY(runId), JSON.stringify([...hide]));
    } catch {}
  }

  function toggleKeyword(k: string) {
    const next = new Set(chosen ?? []);
    next.has(k) ? next.delete(k) : next.add(k);
    setChosen(next);
    persist(next, hidden);
  }

  function toggleDomain(d: string) {
    const next = new Set(hidden);
    next.has(d) ? next.delete(d) : next.add(d);
    setHidden(next);
    persist(chosen ?? new Set(), next);
  }

  const selected = useMemo(
    () => ranked.filter(v => chosen?.has(v.row.keyword)),
    [ranked, chosen],
  );

  // Domain picker options: everything appearing in the selected keywords, most
  // widespread first, since a domain across many SERPs is the one worth a
  // deliberate decision.
  const domainOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of selected) {
      for (const d of v.row.domains) {
        counts.set(d.domain, (counts.get(d.domain) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [selected]);

  // Seed the hidden set once, from the noise list, and only for domains this
  // run actually contains.
  useEffect(() => {
    if (hidden.size > 0 || domainOptions.length === 0) return;
    try {
      if (localStorage.getItem(HIDE_KEY(runId))) return;
    } catch {}
    const seed = new Set(domainOptions.map(([d]) => d).filter(isNoise));
    if (seed.size) setHidden(seed);
  }, [domainOptions, hidden.size, runId]);

  const visibleDomains = (row: AnalysisRow): AnalysisDomain[] =>
    row.domains.filter(d => !hidden.has(d.domain));

  const started = run?.started_at ? new Date(run.started_at).toLocaleDateString(
    lang === "ru" ? "ru-RU" : "en-GB",
    { year: "numeric", month: "long", day: "numeric" },
  ) : "";
  const market = (analysis.country ?? "").toUpperCase();

  // The three columns the reader has not met before. Built once so the printed
  // page and the PDF cannot end up explaining them differently.
  const legend: [string, string][] = [
    [t.report.colDifficulty, t.report.legendDifficulty],
    [t.report.colBar, t.report.legendBar(depth)],
    [t.report.colBarRd, t.report.legendBarRd],
    [t.report.colScore, t.report.legendScore],
  ];

  async function download() {
    setBusy(true);
    try {
      await downloadReportPdf(
        selected.map(v => ({
          row: v.row,
          opp: v.opp,
          bands: v.bands,
          cohortDr: v.cohortDr,
          cohortRd: v.cohortRd,
          slots: v.inDepth.length,
          domains: visibleDomains(v.row),
        })),
        {
          title: t.report.title,
          subtitle: t.report.subtitle(market, started),
          footer: t.report.footer(jobName, runId),
          summary: t.report.summary,
          stats: [
            [t.report.analysed, num(analysis.rows.length)],
            [t.report.shortlisted, num(selected.length)],
            [t.report.reachableVolume, num(totalVolume)],
          ],
          shortlistTitle: t.report.shortlistTitle,
          shortlistLead: t.report.shortlistLead(selected.length),
          shortlistHead: [
            t.report.colRank, t.report.colKeyword, t.report.colVolume,
            t.report.colDifficulty, t.report.colBar, t.report.colBarRd,
            t.report.colSoft, t.report.colScore,
          ],
          legend,
          detailTitle: t.report.detailTitle,
          competitors: t.report.competitors,
          aiComment: t.report.aiComment,
          noDomains: t.report.noDomains,
          domainHead: [
            t.report.colDomain, t.report.colAge, t.report.colBacklinks,
            t.report.colRefdomains, t.report.colKeywordsTop,
            t.report.colKeywords410,
          ],
          difficultyLabel: (k: string | null) =>
            k ? t.analysis.difficultyLabels[k] ?? k : "—",
          page: t.report.page,
        },
        t.report.filename(slugify(jobName), runId),
      );
    } finally {
      setBusy(false);
    }
  }

  const totalVolume = selected.reduce((n, v) => n + (v.row.volume ?? 0), 0);

  if (ranked.length === 0) {
    return <div className="text-sm text-neutral-600 dark:text-neutral-400">{t.report.empty}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Controls. print:hidden keeps them out of the PDF entirely. */}
      <div className="print:hidden border rounded-md dark:border-neutral-700 p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium text-sm">{t.report.controls}</span>
          <label className="text-xs flex items-center gap-1.5">
            {t.report.lang}
            <select
              value={lang}
              onChange={e => setLang(e.target.value as Lang)}
              className="px-2 py-1 rounded border text-sm bg-white dark:bg-neutral-900 dark:border-neutral-700"
            >
              <option value="ru">RU</option>
              <option value="en">EN</option>
            </select>
          </label>
          <button
            type="button"
            onClick={download}
            disabled={busy}
            className="ml-auto px-3 py-1.5 text-sm rounded-md bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 disabled:opacity-50"
          >
            {busy ? t.report.downloading : t.report.download}
          </button>
        </div>

        <Picker
          title={`${t.report.keywordPicker} (${selected.length}/${ranked.length})`}
          onAll={() => {
            const all = new Set(ranked.map(v => v.row.keyword));
            setChosen(all); persist(all, hidden);
          }}
          onNone={() => { setChosen(new Set()); persist(new Set(), hidden); }}
          allLabel={t.report.selectAll}
          noneLabel={t.report.selectNone}
        >
          {ranked.map(v => (
            <Chip
              key={v.row.keyword}
              on={!!chosen?.has(v.row.keyword)}
              onClick={() => toggleKeyword(v.row.keyword)}
              label={v.row.keyword}
              note={num(v.row.volume)}
            />
          ))}
        </Picker>

        <Picker
          title={`${t.report.domainPicker} (${domainOptions.length - hidden.size}/${domainOptions.length})`}
          hint={t.report.domainPickerHint}
          onAll={() => { setHidden(new Set()); persist(chosen ?? new Set(), new Set()); }}
          onNone={() => {
            const all = new Set(domainOptions.map(([d]) => d));
            setHidden(all); persist(chosen ?? new Set(), all);
          }}
          allLabel={t.report.selectAll}
          noneLabel={t.report.selectNone}
        >
          {domainOptions.map(([d, n]) => (
            <Chip
              key={d}
              on={!hidden.has(d)}
              onClick={() => toggleDomain(d)}
              label={d}
              note={t.report.inKeywords(n)}
            />
          ))}
        </Picker>
      </div>

      {/* ---- The document itself ---- */}
      <article className="report space-y-6">
        <header className="border-b dark:border-neutral-700 pb-3">
          <h1 className="text-2xl font-semibold">{t.report.title}</h1>
          <div className="text-sm text-neutral-600 dark:text-neutral-400">
            {t.report.subtitle(market, started)}
          </div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            {t.report.footer(jobName, runId)}
          </div>
        </header>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{t.report.summary}</h2>
          <div className="grid grid-cols-3 gap-3">
            <Stat label={t.report.analysed} value={num(analysis.rows.length)} />
            <Stat label={t.report.shortlisted} value={num(selected.length)} />
            <Stat label={t.report.reachableVolume} value={num(totalVolume)} />
          </div>
        </section>

        <section className="space-y-2 break-inside-avoid">
          <h2 className="text-lg font-semibold">{t.report.shortlistTitle}</h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {t.report.shortlistLead(selected.length)}
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b dark:border-neutral-700">
                <th className="py-1.5 pr-2 font-medium">{t.report.colRank}</th>
                <th className="py-1.5 pr-2 font-medium">{t.report.colKeyword}</th>
                <th className="py-1.5 pr-2 font-medium text-right">{t.report.colVolume}</th>
                <th className="py-1.5 pr-2 font-medium">{t.report.colDifficulty}</th>
                <th className="py-1.5 pr-2 font-medium text-right">{t.report.colBar}</th>
                <th className="py-1.5 pr-2 font-medium text-right">{t.report.colBarRd}</th>
                <th className="py-1.5 pr-2 font-medium text-right">{t.report.colSoft}</th>
                <th className="py-1.5 font-medium text-right">{t.report.colScore}</th>
              </tr>
            </thead>
            <tbody>
              {selected.map((v, i) => (
                <tr key={v.row.keyword} className="border-b dark:border-neutral-800">
                  <td className="py-1.5 pr-2 tabular-nums text-neutral-500 dark:text-neutral-400">{i + 1}</td>
                  <td className="py-1.5 pr-2 font-medium">{v.row.keyword}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{num(v.row.volume)}</td>
                  <td className="py-1.5 pr-2">
                    {v.row.difficulty
                      ? t.analysis.difficultyLabels[v.row.difficulty] ?? v.row.difficulty
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {v.cohortDr == null ? "—" : `DR ${v.cohortDr.toFixed(0)}`}
                  </td>
                  {/* Whole domains: an average of two or three competitors can
                      land on a fraction, and half a referring domain is not a
                      thing anyone can go and build. */}
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {v.cohortRd == null ? "—" : num(Math.round(v.cohortRd))}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {v.bands.soft}/{v.inDepth.length}
                  </td>
                  <td className="py-1.5 text-right tabular-nums font-semibold">
                    {(v.opp.score as number).toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Sits under the table rather than above it: someone who already
              knows the columns should reach the keywords first. */}
          <dl className="text-xs text-neutral-600 dark:text-neutral-400 space-y-0.5 pt-1">
            {legend.map(([term, text]) => (
              <div key={term} className="flex gap-1.5">
                <dt className="font-medium whitespace-nowrap">{term} —</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t.report.detailTitle}</h2>
          {selected.map(v => {
            const doms = visibleDomains(v.row);
            return (
              <div
                key={v.row.keyword}
                className="border rounded-md dark:border-neutral-700 p-3 space-y-2 break-inside-avoid"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-semibold">{v.row.keyword}</span>
                  <span className="text-sm text-neutral-600 dark:text-neutral-400">
                    {num(v.row.volume)} · {v.row.difficulty
                      ? t.analysis.difficultyLabels[v.row.difficulty] ?? v.row.difficulty
                      : "—"}
                  </span>
                  <span className="ml-auto text-sm font-semibold tabular-nums">
                    {(v.opp.score as number).toFixed(1)}
                  </span>
                </div>

                {v.row.comment && (
                  <div className="text-sm">
                    <div className="text-xs text-neutral-500 dark:text-neutral-400">
                      {t.report.aiComment}
                    </div>
                    <p className="text-neutral-700 dark:text-neutral-300">{v.row.comment}</p>
                  </div>
                )}

                <div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">
                    {t.report.competitors}
                  </div>
                  {doms.length === 0 ? (
                    <div className="text-xs text-neutral-500 dark:text-neutral-400">
                      {t.report.noDomains}
                    </div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-neutral-500 dark:text-neutral-400">
                          <th className="py-1 pr-2 font-medium">{t.report.colDomain}</th>
                          <th className="py-1 pr-2 font-medium text-right">{t.report.colAge}</th>
                          <th className="py-1 pr-2 font-medium text-right">{t.report.colBacklinks}</th>
                          <th className="py-1 pr-2 font-medium text-right">{t.report.colRefdomains}</th>
                          <th className="py-1 pr-2 font-medium text-right">{t.report.colKeywordsTop}</th>
                          <th className="py-1 font-medium text-right">{t.report.colKeywords410}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {doms.map(d => (
                          <tr key={d.domain} className="border-t dark:border-neutral-800">
                            <td className="py-1 pr-2 font-mono break-all">{d.domain}</td>
                            <td className={`py-1 pr-2 text-right tabular-nums ${
                              d.age_days != null && d.age_days < 365
                                ? "text-red-700 dark:text-red-400 font-medium" : ""
                            }`}>
                              {formatAge(d.age_days)}
                            </td>
                            <td className="py-1 pr-2 text-right tabular-nums">
                              {num(d.metrics.backlinks_dofollow)}
                            </td>
                            <td className="py-1 pr-2 text-right tabular-nums">
                              {num(d.metrics.refdomains_dofollow)}
                            </td>
                            <td className="py-1 pr-2 text-right tabular-nums">
                              {num(d.metrics.org_keywords_1_3)}
                            </td>
                            <td className="py-1 text-right tabular-nums">
                              {num(d.metrics.org_keywords_4_10)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      </article>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-md dark:border-neutral-700 px-3 py-2">
      <div className="text-xs text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Picker({
  title, hint, children, onAll, onNone, allLabel, noneLabel,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  onAll: () => void;
  onNone: () => void;
  allLabel: string;
  noneLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">{title}</span>
        <button type="button" onClick={onAll}
          className="text-xs px-2 py-0.5 rounded border dark:border-neutral-700">{allLabel}</button>
        <button type="button" onClick={onNone}
          className="text-xs px-2 py-0.5 rounded border dark:border-neutral-700">{noneLabel}</button>
      </div>
      {hint && <div className="text-xs text-neutral-500 dark:text-neutral-400">{hint}</div>}
      <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">{children}</div>
    </div>
  );
}

function Chip({
  on, onClick, label, note,
}: { on: boolean; onClick: () => void; label: string; note?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`px-2 py-0.5 text-xs rounded border transition-colors ${
        on
          ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 border-neutral-900 dark:border-white"
          : "border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400"
      }`}
    >
      {label}
      {note && <span className={`ml-1 ${on ? "opacity-60" : "text-neutral-500 dark:text-neutral-400"}`}>{note}</span>}
    </button>
  );
}
