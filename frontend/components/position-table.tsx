"use client";
import { ReactNode, useState } from "react";
import {
  AverageRow, AverageSerpGroup, ProjectAverages, ProjectPositions, SerpGroup,
  SerpIdentity,
} from "@/lib/api";
import { useT } from "@/lib/i18n";
import { variantLabel } from "@/lib/browser-urls";
import { Empty as KitEmpty, Meter, positionTone, Tone, TONE_PILL } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Tip } from "@/components/tip";

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
 * Two views share that shape and answer different questions. `PositionTable`
 * is where we stand now — the latest run of each keyword. `AveragePositionTable`
 * is how we have held up across the window — every run, averaged.
 *
 * Where a job asked for it, a hit is credited to the host the engine DISPLAYED
 * rather than the one the link opens — an AMP or CDN result belongs to its
 * publisher. Those hits are marked in both views, and in the latest one the raw
 * host is one click away: the same field a publisher uses honestly is the one a
 * doorway spoofs, so the substitution must never be silent.
 */

// --------------------------------------------------------------------------
// The frame both views sit in
// --------------------------------------------------------------------------

/** One block per engine. Google and Yandex are different products with
 *  different result sets, so reading them as one run-on stack of tables makes
 *  the reader keep track of which is which; a heading does that instead.
 *  Alphabetical, so the order never moves between visits. */
function EngineSections<S extends SerpIdentity>({
  serps,
  render,
}: {
  serps: S[];
  render: (serp: S) => ReactNode;
}) {
  const { t } = useT();
  const byEngine = new Map<string, S[]>();
  for (const serp of serps) {
    const list = byEngine.get(serp.engine);
    if (list) list.push(serp);
    else byEngine.set(serp.engine, [serp]);
  }

  return (
    <>
      {[...byEngine.keys()].sort().map(engine => (
        <section key={engine} className="space-y-5">
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
              one engine's set rather than as unrelated blocks — but wide
              enough that two stacked tables never read as one. */}
          <div className="space-y-8">
            {(byEngine.get(engine) ?? []).map(serp => render(serp))}
          </div>
        </section>
      ))}
    </>
  );
}

/** The bordered card around one SERP's table: which page this is, one badge of
 *  context, and the explanation behind an ⓘ rather than repeated under every
 *  table. */
function SerpCard({
  serp,
  badge,
  headline,
  info,
  children,
}: {
  serp: SerpIdentity;
  badge: ReactNode;
  /** The one number worth reading before the table, in its own pill. */
  headline?: ReactNode;
  info: string;
  children: ReactNode;
}) {
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

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/60">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
          <Icon name="globe" className="h-3.5 w-3.5" />
        </span>
        <span className="text-sm font-semibold tracking-tight">{label}</span>
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {badge}
        </span>
        {headline}
        <Tip text={info} label={info} className="ml-auto" />
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

const TH = "px-3 py-2 font-medium";
const THEAD =
  "border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400";

// --------------------------------------------------------------------------
// Latest: where each keyword stands now
// --------------------------------------------------------------------------

/**
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
  // Off by default, as asked: the resolved host is the answer, the raw one is
  // the evidence behind it.
  const [showRaw, setShowRaw] = useState(false);

  if (data.project.domains.length === 0) return <KitEmpty>{t.positions.noDomains}</KitEmpty>;
  if (data.serps.length === 0) return <KitEmpty>{t.positions.noRuns}</KitEmpty>;

  const substituted = data.serps.reduce(
    (n, s) => n + s.rows.reduce((m, r) => m + r.hits.filter(h => h.substituted).length, 0),
    0,
  );

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
      <EngineSections
        serps={data.serps}
        render={serp => (
          <SerpCard
            key={serp.key}
            serp={serp}
            info={t.positions.footnote}
            badge={t.positions.ranking(
              serp.rows.filter(r => r.hits.length > 0).length,
              serp.rows.length,
            )}
            headline={
              serp.share > 0 ? (
                // How much of this SERP the project holds on an average
                // keyword. Deliberately uncoloured: a project's domain list
                // holds the brand AND the doorways impersonating it, so a high
                // share can be the brand owning its own query or a network
                // having taken it over. Tinting it would assert which, and the
                // number cannot tell.
                <Tip
                  text={t.positions.serpShareHint}
                  className="rounded-md bg-slate-900 px-1.5 py-0.5 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                >
                  {t.positions.serpShare(pct(serp.share))}
                </Tip>
              ) : undefined
            }
          >
            <LatestRows serp={serp} showRaw={showRaw} />
          </SerpCard>
        )}
      />
    </div>
  );
}

function LatestRows({ serp, showRaw }: { serp: SerpGroup; showRaw: boolean }) {
  const { t } = useT();
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className={THEAD}>
          <th className={`w-64 ${TH}`}>{t.positions.colKeyword}</th>
          <th className={TH}>{t.positions.colOurPositions}</th>
          <th className={`whitespace-nowrap text-right ${TH}`}>
            <span className="inline-flex items-center gap-1">
              {t.positions.colShare}
              <Tip text={t.positions.shareWhat} label={t.positions.colShare} />
            </span>
          </th>
          <th className={`whitespace-nowrap text-right ${TH}`}>{t.positions.colChecked}</th>
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
                  {/* A span rather than one big link: the markers inside are
                      their own explanations now, and a button cannot sit
                      inside an anchor. */}
                  {r.hits.map(h => (
                    <span
                      key={h.domain}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${TONE_PILL[positionTone(h.position)]}`}
                    >
                      <a
                        href={h.url ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        title={h.url ?? undefined}
                        className="inline-flex items-center gap-1.5 transition hover:underline"
                      >
                        <span className="font-semibold tabular-nums">{h.position}</span>
                        <span className="font-mono">{h.domain}</span>
                      </a>
                      {/* A site holding several listings has taken several
                          slots off the page. The pill reports its best one, so
                          the others would be invisible without this. */}
                      {h.positions.length > 1 && (
                        <Tip
                          text={t.positions.multiSlotHint(h.positions.join(", "), h.share)}
                          label={t.positions.multiSlot(h.positions.length)}
                          className="tabular-nums opacity-70"
                        >
                          ×{h.positions.length}
                        </Tip>
                      )}
                      {/* Marked even when the raw host is hidden: a reader
                          must be able to see that a substitution happened
                          without having to go looking for it. */}
                      {h.substituted && (
                        <Tip
                          text={t.positions.substitutedHint(h.shown_host ?? "", h.linked_host ?? "")}
                          label={t.positions.substituted}
                          className="text-amber-700 dark:text-amber-400"
                        >
                          ⇄
                        </Tip>
                      )}
                      {/* Asked to resolve, nothing to resolve with. Shown so a
                          fallback to the raw link never passes for a resolved
                          one. */}
                      {h.unresolved && (
                        <Tip
                          text={t.positions.unresolvedHint}
                          label={t.positions.unresolvedHint}
                          className="text-slate-600 dark:text-slate-400"
                        >
                          ?
                        </Tip>
                      )}
                      {h.substituted && showRaw && (
                        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          → {h.linked_host}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </td>
            {/* Monopolisation: how much of this page the project holds. Every
                slot counts, weighted by position, so #2 + #5 + #6 is not the
                same as three slots at the bottom. The raw count sits under it
                because a percentage off a thin scrape is otherwise
                indistinguishable from one off a full page. */}
            <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
              {r.slots === 0 ? (
                <span className="text-xs text-slate-400 dark:text-slate-500">–</span>
              ) : (
                <>
                  <Tip
                    text={t.positions.shareHint(r.slots, r.slots_total)}
                    className="text-sm font-semibold"
                  >
                    {pct(r.share)}
                  </Tip>
                  <Tip
                    text={
                      r.short_page
                        ? t.positions.shortPageHint(r.slots_total)
                        : t.positions.slotsHint(r.slots, r.slots_total)
                    }
                    className={`block w-full text-[11px] ${
                      r.short_page
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    {t.positions.shareSlots(r.slots, r.slots_total)}
                    {r.short_page && " ⚠"}
                  </Tip>
                </>
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
  );
}

// --------------------------------------------------------------------------
// Average: how each keyword held up across the window
// --------------------------------------------------------------------------

/** Presence, not rank. A domain on the page every time is visible; one that
 *  appears half the time is not, however well it ranks when it does. */
function visibilityTone(pct: number): Tone {
  if (pct >= 90) return "good";
  if (pct >= 50) return "warn";
  return "bad";
}

/** 100 rather than 100.0, but 66.7 kept — a third of the runs is not 67%. */
function pct(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

/**
 * One row per keyword AND domain, averaged over every run of that SERP in the
 * range.
 *
 * The average covers only the runs where the domain was actually present.
 * There is no position for "was not on the page" — the captured depth belongs
 * to the run, not to the domain — so an absence is counted instead of folded
 * in, and presence is reported beside the average as its own figure. That pair
 * is the point: holding #3 on a third of the readings is a worse result than
 * holding #6 on all of them, and an average alone says the opposite.
 */
export function AveragePositionTable({ data }: { data: ProjectAverages }) {
  const { t } = useT();

  if (data.project.domains.length === 0) return <KitEmpty>{t.positions.noDomains}</KitEmpty>;
  if (data.serps.length === 0) return <KitEmpty>{t.positions.noAverages}</KitEmpty>;

  return (
    <div className="space-y-10">
      <EngineSections
        serps={data.serps}
        render={serp => (
          <SerpCard
            key={serp.key}
            serp={serp}
            info={t.positions.avgFootnote}
            badge={t.positions.serpRuns(serp.runs)}
          >
            <AverageRows serp={serp} />
          </SerpCard>
        )}
      />
    </div>
  );
}

function AverageRows({ serp }: { serp: AverageSerpGroup }) {
  const { t } = useT();
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className={THEAD}>
          <th className={`w-56 ${TH}`}>{t.positions.colKeyword}</th>
          <th className={TH}>{t.positions.colDomain}</th>
          <th className={`whitespace-nowrap text-right ${TH}`}>
            <span className="inline-flex items-center gap-1">
              {t.positions.colVisibility}
              <Tip text={t.positions.visibilityWhat} label={t.positions.colVisibility} />
            </span>
          </th>
          <th className={`whitespace-nowrap text-right ${TH}`}>{t.positions.colAvgPosition}</th>
          <th className={`whitespace-nowrap text-right ${TH}`}>{t.positions.colSpread}</th>
          <th className={`whitespace-nowrap text-right ${TH}`}>{t.positions.colPresent}</th>
          <th className={`whitespace-nowrap text-right ${TH}`}>{t.positions.colAbsent}</th>
          <th className={`whitespace-nowrap text-right ${TH}`}>{t.positions.colRuns}</th>
        </tr>
      </thead>
      <tbody>
        {serp.rows.map((row, group) => (
          <AverageKeyword key={row.keyword} row={row} first={group === 0} />
        ))}
      </tbody>
    </table>
  );
}

/** A keyword and every domain of ours that appeared on it at least once. The
 *  keyword is printed once, on the first of its rows, so the column reads as a
 *  list of keywords rather than as the same word repeated. */
function AverageKeyword({ row, first }: { row: AverageRow; first: boolean }) {
  const { t } = useT();
  // A rule above the first row of each group is what separates one keyword's
  // block from the next, now that the keyword cell below it is blank.
  const edge = first ? "" : "border-t border-slate-200 dark:border-t-slate-700";
  const cell = "px-3 py-2.5 text-right tabular-nums";

  if (row.hits.length === 0) {
    return (
      <tr className={`text-slate-400 dark:text-slate-500 ${edge}`}>
        <td className="break-words px-3 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100">
          {row.keyword}
        </td>
        {/* Measured and never seen is a finding, not a gap: it is the 0% end of
            the same visibility scale the rows below it are measured on. */}
        <td colSpan={6} className="px-3 py-2.5 text-xs">
          {t.positions.neverRanked(row.runs)}
        </td>
        <td className={`${cell} text-xs`}>{row.runs}</td>
      </tr>
    );
  }

  return (
    <>
      {row.hits.map((h, i) => (
        <tr
          key={`${row.keyword}|${h.domain}`}
          className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${i === 0 ? edge : ""}`}
        >
          <td className="break-words px-3 py-2.5 text-sm font-medium">
            {i === 0 && (
              <>
                {row.keyword}
                {/* What the project holds on this page between all its
                    domains. Shares are fractions of one page, so they add up
                    — owning every slot would be exactly 100%. */}
                <Tip
                  text={t.positions.projectShareHint}
                  className="block text-[11px] font-normal text-slate-500 dark:text-slate-400"
                >
                  {t.positions.projectShare(pct(row.visibility))}
                </Tip>
              </>
            )}
          </td>
          <td className="break-words px-3 py-2.5 font-mono text-xs">
            {h.domain}
            {/* An average must not become the one place a substitution goes
                unmarked — it is the same field a doorway spoofs. */}
            {h.substituted_in > 0 && (
              <Tip
                text={t.positions.substitutedIn(h.substituted_in, h.ranked_in)}
                label={t.positions.substituted}
                className="ml-1 text-amber-700 dark:text-amber-400"
              >
                ⇄
              </Tip>
            )}
            {/* Two providers number the same slot differently, so this mean
                blends two rulers. Said out loud rather than silently averaged. */}
            {h.mixed_providers && (
              <Tip
                text={t.positions.mixedProvidersHint(h.providers.join(", "))}
                label={t.positions.mixedProviders}
                className="ml-1 text-amber-700 dark:text-amber-400"
              >
                ≈
              </Tip>
            )}
            {/* Same doubt, weaker evidence: runs from before the provider was
                recorded. Quieter than the flag above because it is a gap in
                what we know, not something we found. */}
            {!h.mixed_providers && h.unknown_providers > 0 && (
              <Tip
                text={t.positions.unknownProviderHint(h.unknown_providers, h.ranked_in)}
                label={t.positions.unknownProvider}
                className="ml-1 text-slate-500 dark:text-slate-400"
              >
                ?
              </Tip>
            )}
          </td>
          {/* The headline, and what the rows are sorted by: the one figure
              that is position and presence at once. */}
          <td className={`${cell} font-semibold`}>
            <Tip text={t.positions.visibilityHint(h.visibility, h.ranked_in, h.runs)}>
              {pct(h.visibility)}
            </Tip>
          </td>
          <td className="px-3 py-2.5 text-right">
            <Tip
              text={t.positions.avgHint(h.ranked_in, h.runs)}
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${TONE_PILL[positionTone(Math.round(h.avg_position))]}`}
            >
              {h.avg_position.toFixed(1)}
            </Tip>
          </td>
          <td className={`${cell} whitespace-nowrap text-xs text-slate-500 dark:text-slate-400`}>
            {h.best === h.worst ? h.best : `${h.best} – ${h.worst}`}
          </td>
          <td className={cell}>
            <Tip
              text={t.positions.presentHint(h.ranked_in, h.runs)}
              className="inline-flex items-center justify-end gap-1.5"
            >
              <Meter
                value={h.present_pct}
                max={100}
                tone={visibilityTone(h.present_pct)}
                className="w-10"
              />
              <span className="text-xs font-medium">{pct(h.present_pct)}</span>
            </Tip>
          </td>
          <td className={`${cell} text-xs`}>
            <Tip
              text={t.positions.absentHint(h.runs - h.ranked_in, h.runs)}
              className={h.absent_pct > 0 ? "text-amber-700 dark:text-amber-400" : "text-slate-400 dark:text-slate-500"}
            >
              {pct(h.absent_pct)}
            </Tip>
          </td>
          <td className={`${cell} text-xs text-slate-500 dark:text-slate-400`}>
            {i === 0 ? row.runs : ""}
          </td>
        </tr>
      ))}
    </>
  );
}
