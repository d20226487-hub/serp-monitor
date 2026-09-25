"use client";
import { useEffect, useMemo, useState } from "react";
import { AnalysisRow, AnalysisUrl, RunAnalysis } from "@/lib/api";
import { useT } from "@/lib/i18n";
import {
  Band,
  BandThresholds,
  CohortStat,
  DEPTHS,
  Depth,
  bandCounts,
  bandOf,
  barHeight,
  cohortAverage,
  cohortSizeFor,
  ladderDriver,
  runCeiling,
  weakestCohort,
  weaknessRanker,
  withinDepth,
} from "@/lib/serp-strength";
import {
  CsvColumnOverrides,
  analysisCsvFilename,
  buildAnalysisCsv,
  downloadCsv,
  selectedAnalysisCsvColumns,
} from "@/lib/analysis-csv";
import { CsvColumnPicker } from "@/components/csv-columns";
import { ChevronDown, Columns3 } from "lucide-react";
import { METRIC_LABELS } from "@/lib/metric-labels";
import {
  Balance,
  OpportunityParts,
  SHORTLIST,
  OpportunityFormula,
  maxVolumeOf,
  scoreRow,
  weightsFor,
} from "@/lib/opportunity";
import { api } from "@/lib/api";
import { VolumePastePanel } from "@/components/volume-paste";
import { FormulaEditor } from "@/components/opportunity-formula";

/**
 * Analyzer-mode view: one row per keyword showing the ENTRY BAR for the depth
 * you are aiming at — the two weakest pages by DR inside the top N, averaged.
 *
 * This replaced a median per keyword. A median describes no real page: it mixes
 * the strongest result's DR with the weakest result's UR and reports the blend
 * as if it were a competitor. Here every column describes the SAME two pages,
 * so the row is a profile of the competitors you would actually displace.
 *
 * Alongside it, a per-position ladder gives the SHAPE of the SERP at a glance —
 * bar height is page strength, colour is how displaceable that slot looks — so
 * "soft at #2 and #5" reads without opening anything. The cohort the numbers
 * come from is marked underneath it.
 */

type SortKey = string; // "keyword" | "coverage" | "soft" | a metric id

// Green through red — the verdict should be readable at a glance down a column.
const DIFFICULTY_STYLE: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
  hard: "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-200",
  "too hard": "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200",
};

// One ramp, easiest to hardest. `propped` sits mid-ramp on purpose: the page is
// takeable but the domain behind it is not.
const BAND_BAR: Record<Band, string> = {
  soft: "bg-emerald-500",
  propped: "bg-amber-400",
  moderate: "bg-orange-500",
  strong: "bg-red-500",
  unknown: "bg-slate-300 dark:bg-slate-600",
};

const DEPTH_KEY = "analysisDepth";
const BALANCE_KEY = "analysisBalance";
// Versioned: the first cut of the picker labelled a metric's page COUNT as
// "UR: pages averaged", which reads as "UR averaged over pages" — the column
// beside it. Selections made under that label say the opposite of what the
// person meant, so they are not worth migrating. Bumping the key resets them
// once, to defaults that are now the table's own columns.
const CSV_COLUMNS_KEY = "analysisCsvColumns.v2";

/** Score colour: a shortlisted keyword should be findable without reading. */
function scoreTone(rank: number | null, shortlist: number): string {
  if (rank == null) return "text-slate-400";
  if (rank <= shortlist) return "text-emerald-700 dark:text-emerald-300 font-semibold";
  return "text-slate-600 dark:text-slate-300";
}

function formatMetric(v: number | null | undefined): string {
  if (v == null) return "—";
  if (Number.isInteger(v)) return v.toLocaleString();
  // DR/UR come back fractional, and averaging two pages can land off a whole
  // number for any metric. One decimal is enough to compare SERPs; grouping
  // still applies, so a half-count of backlinks reads as 11,224.5 rather than
  // 11224.5.
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** "#1" / "#1, #4" — a list of SERP slots. Capped so a long list cannot
 *  push its column wide. */
function positionsLabel(positions: number[]): string {
  if (!positions.length) return "";
  const shown = positions.slice(0, 3).map(p => `#${p}`).join(", ");
  return positions.length > 3 ? `${shown} +${positions.length - 3}` : shown;
}

/**
 * The SERP as a row of bars, one per slot.
 *
 * Slots are laid out by absolute position, so a gap — an ad or an AI block
 * holding that place — stays visible as an empty slot rather than being closed
 * up. Closing it would silently renumber every result below it.
 */
function Ladder({
  urls, depth, driver, ceiling, cohort, bands,
}: {
  urls: AnalysisUrl[];
  depth: Depth;
  driver: string | null;
  ceiling: number;
  cohort: AnalysisUrl[];
  /** Same thresholds the Soft slots column counts by, so a bar's colour and
   *  the count beside it can never disagree. */
  bands: BandThresholds;
}) {
  const { t } = useT();
  const inDepth = withinDepth(urls, depth);
  const lastSlot = depth === 0
    ? urls.reduce((m, u) => Math.max(m, u.position), 0)
    : depth;
  if (!driver || lastSlot === 0) return <span className="text-slate-500 dark:text-slate-400">—</span>;

  const byPos = new Map(inDepth.map(u => [u.position, u]));
  const slots = Array.from({ length: lastSlot }, (_, i) => i + 1);
  // Which slots the row's numbers were averaged from, so the table and the
  // picture cannot drift apart.
  const picked = new Set(cohort.map(u => u.position));

  return (
    <div className="flex items-end gap-[3px]">
      {slots.map(pos => {
        const u = byPos.get(pos);
        // Each slot is a fixed column: bar on top, cohort marker underneath.
        // The marker goes below rather than around the bar because at 7px wide
        // and 3px apart an outline would bleed into the neighbouring slot.
        const marker = (
          <span
            className={`mt-[3px] w-[3px] h-[3px] rounded-full ${picked.has(pos) ? "bg-slate-500 dark:bg-slate-300" : "bg-transparent"
            }`}
          />
        );
        if (!u) {
          // Nothing organic in this slot.
          return (
            <span
              key={pos}
              title={t.analysis.gapHint(pos)}
              className="flex flex-col items-center justify-end w-[7px] h-[30px]"
            >
              <span className="w-full h-px bg-slate-300 dark:bg-slate-700" />
              {marker}
            </span>
          );
        }
        const band = bandOf(u.metrics, u.analysed, driver, bands);
        const h = barHeight(u.metrics?.[driver], driver, ceiling);
        const label = [
          `#${pos}`,
          hostOf(u.url),
          `${METRIC_LABELS[driver] ?? driver} ${formatMetric(u.metrics?.[driver])}`,
          t.analysis.bandHints[band] ?? "",
          picked.has(pos) ? t.analysis.inCohort : "",
        ].filter(Boolean).join(" · ");
        return (
          <span
            key={pos}
            title={label}
            className="flex flex-col items-center justify-end w-[7px] h-[30px]"
          >
            <span
              // A floor of 3px keeps a UR-0 page visible as an occupied slot —
              // it ranks, it just has nothing behind it.
              style={{ height: `${Math.max(3, Math.round(h * 24))}px` }}
              className={`w-full rounded-sm ${BAND_BAR[band]}`}
            />
            {marker}
          </span>
        );
      })}
    </div>
  );
}

/** Compact domain age: "12 d", "4 mo", "1.3 y", "26 y".
 *
 *  Mirrors the backend's format_age so the figure the AI judge was given and
 *  the figure on screen read identically. Years carry a decimal only below ten,
 *  where 1.2 versus 1.9 changes how a domain reads; past that it is noise. */
function formatAge(days: number | null | undefined): string | null {
  if (days == null) return null;
  if (days < 31) return `${days} d`;
  if (days < 365) return `${Math.floor(days / 30)} mo`;
  const years = days / 365.25;
  return years < 10 ? `${years.toFixed(1)} y` : `${years.toFixed(0)} y`;
}

/** Young domains are the whole point of showing age, so they get the emphasis.
 *  Thresholds match the "is this a doorway" question rather than anything in
 *  the WHOIS data: under a year is suspicious, under three is worth a look. */
function ageTone(days: number | null | undefined): string {
  if (days == null) return "text-slate-400";
  if (days < 365) return "text-red-600 dark:text-red-400 font-medium";
  if (days < 3 * 365) return "text-amber-700 dark:text-amber-400";
  return "text-slate-600 dark:text-slate-300";
}

function DomainSubTable({
  row, metrics, showWhois,
}: { row: AnalysisRow; metrics: string[]; showWhois: boolean }) {
  const { t } = useT();
  // Either column set is reason enough to render: domain metrics and domain
  // age are separate job switches, and requiring both would hide the age
  // whenever it was enabled on its own.
  if ((!metrics.length && !showWhois) || !row.domains?.length) return null;
  return (
    <div className="mt-3">
      <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">{t.analysis.rawDomainTitle}</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-600 dark:text-slate-400">
            <th className="px-2 py-1 font-medium">{t.analysis.colDomain}</th>
            {showWhois && (
              <>
                <th className="px-2 py-1 font-medium text-right">{t.analysis.colAge}</th>
                <th className="px-2 py-1 font-medium">{t.analysis.colRegistrar}</th>
              </>
            )}
            {metrics.map(m => (
              <th key={m} className="px-2 py-1 font-medium text-right">
                {METRIC_LABELS[m] ?? m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row.domains.flatMap(d => {
            const age = formatAge(d.age_days);
            const created = d.created ? d.created.slice(0, 10) : "";
            // A subdomain's parent gets its own indented row. The alternative —
            // one row mixing subdomain metrics with the parent's age — reads as
            // a single entity and is simply wrong about it.
            // Shown for ANY subdomain, not only when the parent's metrics were
            // fetched: the age always belongs to the parent, so the row the
            // subdomain's "↓" points at has to exist regardless. Metrics render
            // as "—" when the parent was not measured (runs made before the
            // domain pass started including parents).
            const parentRow = d.is_subdomain && d.registrable ? (
              <tr key={`${d.domain}-parent`} className="border-t dark:border-slate-800 text-slate-600 dark:text-slate-400">
                <td className="px-2 py-1 font-mono break-all pl-5">
                  <span className="text-slate-500 dark:text-slate-400">└ </span>{d.registrable}
                </td>
                {showWhois && (
                  <>
                    <td className={`px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap ${ageTone(d.age_days)}`}>
                      {age ?? "—"}
                    </td>
                    <td className="px-2 py-1 break-all">{d.registrar || "—"}</td>
                  </>
                )}
                {metrics.map(m => (
                  <td key={m} className="px-2 py-1 text-right font-mono tabular-nums">
                    {formatMetric(d.parent_metrics?.[m])}
                  </td>
                ))}
              </tr>
            ) : null;
            return [(
              <tr key={d.domain} className="border-t dark:border-slate-800">
                <td className="px-2 py-1 font-mono break-all">
                  {d.domain}
                  {/* A subdomain has no registration of its own, so say whose
                      date is on the row rather than implying it is the host's. */}
                  {showWhois && d.is_subdomain && d.registrable && (
                    <span className="ml-1 text-slate-500 dark:text-slate-400">→ {d.registrable}</span>
                  )}
                </td>
                {showWhois && (
                  <>
                    <td
                      className={`px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap ${d.is_subdomain ? "text-slate-500 dark:text-slate-400" : ageTone(d.age_days)
                      }`}
                      title={
                        age
                          ? (d.is_subdomain
                              ? t.analysis.ageSubdomainHint(created, d.registrable ?? "")
                              : t.analysis.ageHint(created, d.registrable ?? d.domain))
                          // "We found nothing" and "we found a record with no
                          // date on it" are different facts, and only one of
                          // them says anything about the domain.
                          : d.whois_checked
                            ? t.analysis.ageNoDateHint
                            : t.analysis.ageUnknownHint
                      }
                    >
                      {/* A subdomain has no registration of its own, so the age
                          sits on the parent row below rather than being shown
                          here as though it were this host's. */}
                      {d.is_subdomain ? "↓" : (age ?? "—")}
                    </td>
                    {/* Registrar belongs to the registration, same as the age
                        — so on a subdomain row it sits on the parent below,
                        not here where it would read as this host's own. */}
                    <td className="px-2 py-1 text-slate-600 dark:text-slate-400 break-all">
                      {d.is_subdomain ? "" : (d.registrar || "—")}
                    </td>
                  </>
                )}
                {metrics.map(m => (
                  <td key={m} className="px-2 py-1 text-right font-mono tabular-nums">
                    {formatMetric(d.metrics[m])}
                  </td>
                ))}
              </tr>
            ), parentRow].filter(Boolean);
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Inline volume entry. Commits on blur or Enter, reverts on Escape.
 *
 * Editable in place because the numbers arrive by hand, ten at a time, off a
 * Keyword Planner tab — a separate settings screen would mean copying keywords
 * back and forth to match them up.
 */
function VolumeCell({
  keyword, volume, country, subNational, onSave,
}: {
  keyword: string;
  volume: number | null;
  country: string | null;
  subNational: boolean;
  onSave: (keyword: string, volume: number) => void;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function commit() {
    setEditing(false);
    const n = Number(draft.replace(/[\s,]/g, ""));
    // A blank box means "leave it alone", not "set it to zero" — clearing a
    // volume is a delete, not an edit, and would change the ranking silently.
    if (!draft.trim() || !Number.isFinite(n) || n < 0) return;
    if (n !== volume) onSave(keyword, Math.round(n));
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        inputMode="numeric"
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-20 px-1 py-0.5 text-right font-mono text-sm rounded border bg-white dark:bg-slate-900 dark:border-slate-700"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => { setDraft(volume == null ? "" : String(volume)); setEditing(true); }}
      title={
        volume == null
          ? t.analysis.volumeEmpty
          : subNational
            ? t.analysis.volumeCityHint((country ?? "").toUpperCase() || t.analysis.volumeAnyCountry)
            : t.analysis.volumeHint(country ?? t.analysis.volumeAnyCountry)
      }
      className={`font-mono tabular-nums hover:underline ${volume == null ? "text-slate-500 dark:text-slate-400" : ""
      }`}
    >
      {volume == null ? t.analysis.volumeAdd : volume.toLocaleString()}
    </button>
  );
}

/**
 * The prompt the AI judge actually received, for this keyword.
 *
 * Collapsed by default because it is long, and shown at all because the
 * verdict it produced is otherwise unauditable: a "too hard" that looks wrong
 * could be the model misreading, or it could be a metric that never made it
 * into the table. You cannot tell those apart without the text.
 */
function PromptInspector({ row }: { row: AnalysisRow }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!row.ai_prompt) return;
    await navigator.clipboard.writeText(row.ai_prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 inline-flex items-center gap-1.5"
      >
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        {t.analysis.promptTitle}
        {row.ai_model && (
          <span className="text-slate-500 dark:text-slate-400">
            ({t.analysis.promptMeta(
              row.ai_model, row.ai_prompt_tokens, row.ai_completion_tokens,
            )})
          </span>
        )}
      </button>
      {open && (
        <div className="mt-1.5 space-y-2">
          <div className="text-xs text-slate-600 dark:text-slate-400">{t.analysis.promptHint}</div>
          {row.ai_prompt ? (
            <>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={copy}
                  className="px-2 py-0.5 text-xs rounded-md border dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {copied ? t.analysis.promptCopied : t.analysis.promptCopy}
                </button>
              </div>
              {/* Monospace and pre-wrap: the markdown table only reads as a
                  table if its column alignment survives. */}
              <pre className="text-xs font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto p-2 rounded border dark:border-slate-800 bg-white dark:bg-slate-950">
                {row.ai_prompt}
              </pre>
              {row.ai_raw && (
                <>
                  <div className="text-xs text-slate-600 dark:text-slate-400">{t.analysis.promptResponse}</div>
                  <pre className="text-xs font-mono whitespace-pre-wrap break-words p-2 rounded border dark:border-slate-800 bg-white dark:bg-slate-950">
                    {row.ai_raw}
                  </pre>
                </>
              )}
            </>
          ) : (
            <div className="text-xs text-amber-700 dark:text-amber-300">
              {t.analysis.promptNone}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One keyword reduced to the numbers the table shows at the current depth. */
type KeywordView = {
  row: AnalysisRow;
  opp: OpportunityParts;
  /** Position in the opportunity ranking, or null when volume is unknown. */
  rank: number | null;
  /** The weakest pages by DR inside the depth — every metric cell averages
   *  THESE pages, so the whole row describes one pair of competitors. */
  cohort: AnalysisUrl[];
  stats: Record<string, CohortStat>;
  bands: Record<Band, number>;
  analysed: number;
  total: number;
};

export function RunAnalysisTable({
  analysis, runId, onRefresh,
}: { analysis: RunAnalysis; runId: number; onRefresh?: () => void }) {
  const { t } = useT();
  const [sortKey, setSortKey] = useState<SortKey>("keyword");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [depth, setDepth] = useState<Depth>(5);
  // 0 = quick wins, 0.5 = equal, 1 = biggest prizes.
  const [balance, setBalance] = useState<Balance>(0.5);
  // Volume edits applied optimistically. The server is the store, but a table
  // that waits for a round trip before showing the number you just typed feels
  // broken when you are entering ten of them.
  const [volumeEdits, setVolumeEdits] = useState<Record<string, number>>({});
  const [pasting, setPasting] = useState(false);
  const [pickingColumns, setPickingColumns] = useState(false);
  const [scoring, setScoring] = useState(false);
  // Only the CSV columns the user has explicitly ticked or unticked; the rest
  // follow their defaults. See lib/analysis-csv for why this is stored as
  // overrides rather than as the selected set.
  const [csvColumns, setCsvColumns] = useState<CsvColumnOverrides>({});
  const [editingFormula, setEditingFormula] = useState(false);
  // Local draft of the effective formula. Seeded from the server, which has
  // already resolved override-or-global, so there is nothing to merge here.
  const [formula, setFormula] = useState<OpportunityFormula>(analysis.formula);
  const [isOverride, setIsOverride] = useState(analysis.formula_is_override);
  const [savingFormula, setSavingFormula] = useState(false);
  // Only needed to say how stale a cached figure can be; the run itself does
  // not record the TTL that was in force.
  const [ahrefsTtlDays, setAhrefsTtlDays] = useState(7);

  useEffect(() => {
    api.getAhrefs().then(a => setAhrefsTtlDays(a.cache_ttl_days)).catch(() => {});
  }, []);

  // Depth is a working preference, not run state — read it back after mount so
  // the server-rendered markup stays deterministic.
  useEffect(() => {
    try {
      // Guard the absent key explicitly: Number(null) is 0, which is a VALID
      // depth here (0 = whole SERP), so a bare Number() would quietly override
      // the top-5 default for every first-time visitor.
      const saved = localStorage.getItem(DEPTH_KEY);
      if (saved !== null) {
        const n = Number(saved);
        if ((DEPTHS as readonly number[]).includes(n)) setDepth(n as Depth);
      }
      const b = localStorage.getItem(BALANCE_KEY);
      if (b !== null) {
        const n = Number(b);
        if (Number.isFinite(n) && n >= 0 && n <= 1) setBalance(n);
      }
      const cols = localStorage.getItem(CSV_COLUMNS_KEY);
      if (cols !== null) {
        // Anything that is not a plain id → boolean map is a stale format, not
        // a preference: fall back to the defaults rather than exporting a file
        // built from garbage.
        const parsed: unknown = JSON.parse(cols);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          setCsvColumns(
            Object.fromEntries(
              Object.entries(parsed as Record<string, unknown>)
                .filter(([, v]) => typeof v === "boolean"),
            ) as CsvColumnOverrides,
          );
        }
      }
    } catch {}
  }, []);

  /** Persisting inside the updater rather than in an effect keeps the write
   *  next to the change without needing a "have we hydrated yet" guard — an
   *  effect would fire once on mount and clobber the stored value with the
   *  empty initial state before the read above had run. */
  function pickCsvColumns(update: (prev: CsvColumnOverrides) => CsvColumnOverrides) {
    setCsvColumns(prev => {
      const next = update(prev);
      try {
        localStorage.setItem(CSV_COLUMNS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  function pickBalance(b: Balance) {
    setBalance(b);
    try {
      localStorage.setItem(BALANCE_KEY, String(b));
    } catch {}
  }

  /** Write one keyword's volume to the global store, keyed on this run's
   *  market so the figure is reused by every future run in that country. */
  async function saveVolume(keyword: string, volume: number) {
    setVolumeEdits(prev => ({ ...prev, [keyword]: volume }));
    try {
      await api.saveKeywordVolumes([
        { keyword, country_code: analysis.country, volume },
      ]);
    } catch {
      // Roll back rather than leave a number on screen that was never stored.
      setVolumeEdits(prev => {
        const next = { ...prev };
        delete next[keyword];
        return next;
      });
    }
  }

  function pickDepth(d: Depth) {
    setDepth(d);
    try {
      localStorage.setItem(DEPTH_KEY, String(d));
    } catch {}
  }

  // Cost of the domain-age phase, expressed per domain. Divided by domains
  // FETCHED rather than by every domain in the run: the cached ones cost
  // nothing, and folding them in would understate what a fresh lookup actually
  // costs — the number you need when sizing a new job.
  const { whoisSummary, whoisHint } = useMemo(() => {
    const cost = analysis.whois_cost ?? 0;
    const domains = analysis.whois_domains ?? 0;
    const fetched = analysis.whois_fetched ?? 0;
    if (cost <= 0 || fetched <= 0) {
      return {
        whoisSummary: t.analysis.whoisCached,
        whoisHint: t.analysis.whoisCachedHint(domains),
      };
    }
    const usd = `$${cost.toFixed(4)}`;
    // Four decimals hides the per-domain figure once a batch gets large
    // ($0.0013 at 1000 domains rounds to $0.0013, but $0.00132 does not).
    const per = cost / fetched;
    const perDomain = `$${per < 0.001 ? per.toFixed(5) : per.toFixed(4)}`;
    return {
      whoisSummary: t.analysis.whoisSpend(usd, perDomain),
      whoisHint: t.analysis.whoisSpendHint(fetched, domains - fetched, usd, perDomain),
    };
  }, [analysis.whois_cost, analysis.whois_domains, analysis.whois_fetched, t]);

  const market = (analysis.country ?? "").toUpperCase();
  // A run spanning several countries is priced in one of them. Say so rather
  // than let a KZ+UZ run read as if its scores covered both.
  const otherMarkets = (analysis.countries ?? [])
    .filter(c => c !== analysis.country)
    .map(c => c.toUpperCase());

  async function saveRunFormula() {
    setSavingFormula(true);
    try {
      const r = await api.setRunFormula(runId, formula);
      setFormula(r.formula);
      setIsOverride(true);
    } finally {
      setSavingFormula(false);
    }
  }

  async function clearRunFormula() {
    setSavingFormula(true);
    try {
      const r = await api.clearRunFormula(runId);
      setFormula(r.formula);
      setIsOverride(false);
    } finally {
      setSavingFormula(false);
    }
  }

  /** Save a pasted batch in one request, then reflect it immediately. */
  async function applyVolumes(rows: { keyword: string; volume: number }[]) {
    if (!rows.length) return;
    await api.saveKeywordVolumes(
      rows.map(r => ({ ...r, country_code: analysis.country })),
    );
    setVolumeEdits(prev => ({
      ...prev,
      ...Object.fromEntries(rows.map(r => [r.keyword, r.volume])),
    }));
  }

  // A run whose process died between the metrics and the verdicts leaves the
  // expensive half done: every keyword here already has its SERP, its Ahrefs
  // metrics and its domain ages stored.
  const missingAi = analysis.rows.filter(r => !r.difficulty).length;
  // Nothing left to attempt — every keyword either has a verdict or a recorded
  // failure. This, not `missingAi`, is what ends the polling: a keyword the
  // model keeps refusing would otherwise leave it running forever.
  const unresolvedAi = analysis.rows.filter(r => !r.difficulty && !r.ai_error).length;

  async function rescoreAi() {
    setScoring(true);
    try {
      await api.rescoreAi(runId);
    } catch {
      setScoring(false);
    }
  }

  // Verdicts are judged one keyword at a time, so pull the table back in while
  // it works and watch the column fill rather than leaving a spinner sitting
  // over a run that takes minutes.
  useEffect(() => {
    if (!scoring) return;
    const started = Date.now();
    const t = setInterval(() => {
      // A cap, because the poll cannot see the backend give up on a keyword
      // that never records anything at all.
      if (Date.now() - started > 20 * 60 * 1000) setScoring(false);
      else onRefresh?.();
    }, 4000);
    return () => clearInterval(t);
  }, [scoring, onRefresh]);

  useEffect(() => {
    if (scoring && unresolvedAi === 0) setScoring(false);
  }, [scoring, unresolvedAi]);

  const driver = useMemo(() => ladderDriver(analysis.metrics), [analysis.metrics]);
  const ranker = useMemo(() => weaknessRanker(analysis.metrics), [analysis.metrics]);
  const rankerLabel = ranker ? METRIC_LABELS[ranker] ?? ranker : "";
  const ceiling = useMemo(
    () => runCeiling(analysis.rows, driver),
    [analysis.rows, driver],
  );

  const views: KeywordView[] = useMemo(() => {
    // Volume edits shadow the server payload until the next refetch.
    const rows = analysis.rows.map(r =>
      r.keyword in volumeEdits ? { ...r, volume: volumeEdits[r.keyword] } : r
    );
    const maxVolume = maxVolumeOf(rows);
    const built = rows.map(row => {
      const inDepth = withinDepth(row.urls, depth);
      const cohort = weakestCohort(inDepth, ranker, cohortSizeFor(inDepth.length));
      const stats: Record<string, CohortStat> = {};
      for (const m of analysis.metrics) stats[m] = cohortAverage(cohort, m);
      return {
        row,
        cohort,
        stats,
        bands: bandCounts(inDepth, driver, formula),
        analysed: inDepth.filter(u => u.analysed).length,
        total: inDepth.length,
        opp: scoreRow(row, depth, analysis.metrics, maxVolume, balance, formula),
        rank: null as number | null,
      };
    });
    // Rank once, here, so every row agrees on the shortlist regardless of the
    // column the table happens to be sorted by.
    const ordered = built
      .filter(v => v.opp.score != null)
      .sort((a, b) => (b.opp.score as number) - (a.opp.score as number));
    ordered.forEach((v, i) => { v.rank = i + 1; });
    return built;
  }, [analysis.rows, analysis.metrics, depth, driver, ranker, balance, volumeEdits, formula]);

  const sorted = useMemo(() => {
    const arr = [...views];
    arr.sort((a, b) => {
      let cmp: number;
      if (sortKey === "keyword") {
        cmp = a.row.keyword.localeCompare(b.row.keyword);
      } else if (sortKey === "coverage") {
        cmp = a.analysed - b.analysed;
      } else if (sortKey === "soft") {
        cmp = a.bands.soft - b.bands.soft;
      } else if (sortKey === "volume" || sortKey === "opportunity") {
        const av = sortKey === "volume" ? a.row.volume : a.opp.score;
        const bv = sortKey === "volume" ? b.row.volume : b.opp.score;
        // Unknown sorts last in both directions: no volume entered is not the
        // same as a low score, and burying it under "worst" would misread it.
        if (av == null && bv == null) cmp = 0;
        else if (av == null) return 1;
        else if (bv == null) return -1;
        else cmp = av - bv;
      } else {
        // Nulls always sort last regardless of direction — an unmeasured
        // keyword isn't "the weakest", it's unknown.
        const av = a.stats[sortKey]?.value;
        const bv = b.stats[sortKey]?.value;
        if (av == null && bv == null) cmp = 0;
        else if (av == null) return 1;
        else if (bv == null) return -1;
        else cmp = av - bv;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [views, sortKey, sortDir]);

  // Overrides can name metrics this run never collected — a selection made on
  // another job. Pruning against THIS run's columns is what the count on the
  // button and the disabled state are read from.
  const csvSelection = useMemo(
    () => selectedAnalysisCsvColumns(analysis.metrics, csvColumns),
    [analysis.metrics, csvColumns],
  );

  // Exports exactly what is on screen: current depth, current sort order.
  function exportCsv() {
    if (!csvSelection.length) return;
    const csv = buildAnalysisCsv(
      sorted.map(v => ({
        keyword: v.row.keyword,
        volume: v.row.volume,
        volumeCountry: v.row.volume_country,
        score: v.opp.score,
        rank: v.rank,
        winnability: v.opp.winnability,
        cohort: v.cohort,
        stats: v.stats,
        bands: v.bands,
        analysed: v.analysed,
        total: v.total,
        difficulty: v.row.difficulty,
        comment: v.row.comment,
      })),
      csvSelection,
      { depth, ranker: ranker ?? "" },
    );
    downloadCsv(analysisCsvFilename(runId, depth), csv);
  }

  function toggle(key: SortKey) {
    if (key === sortKey) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      // The entry bar reads most usefully lowest-first — the easiest way in.
      // Soft slots are the opposite: the keywords worth attacking are the ones
      // with the MOST displaceable positions, so lead with those.
      // Volume and opportunity read best biggest-first, like soft slots.
      setSortDir(["soft", "volume", "opportunity"].includes(key) ? "desc" : "asc");
    }
  }

  const arrow = (key: SortKey) =>
    key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const th =
    "px-3 py-2 font-medium text-slate-600 dark:text-slate-400 cursor-pointer select-none hover:text-slate-900 dark:hover:text-slate-100";

  if (analysis.rows.length === 0) {
    return (
      <div className="border rounded-md p-6 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-400">
        {t.analysis.empty}
      </div>
    );
  }

  return (
    <div className="border rounded-md dark:border-slate-700 overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 border-b dark:border-slate-800 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-medium text-sm">{t.analysis.title}</span>
        <span className="text-xs text-slate-600 dark:text-slate-400">
          {/* No single size to quote any more: it varies per keyword with how
              many results that SERP returned, and each row's cohort label
              names the positions it actually used. */}
          {t.analysis.subtitle(depth, rankerLabel)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditingFormula(e => !e)}
            aria-pressed={editingFormula}
            title={isOverride ? t.formula.runOverridden : t.formula.runInherited}
            className={`px-2 py-0.5 text-xs rounded-md border dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 ${isOverride ? "border-amber-500 dark:border-amber-500" : ""
            }`}
          >
            {t.formula.edit}{isOverride ? " *" : ""}
          </button>
          <button
            type="button"
            onClick={() => setPasting(p => !p)}
            aria-pressed={pasting}
            className="px-2 py-0.5 text-xs rounded-md border dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t.analysis.pasteVolumes}
          </button>
          {/* A split button rather than a menu on the export: the common case
              is downloading the same columns as last run, and burying that
              behind a menu would cost a click every time. The right half has to
              read as the settings half of ONE control though — as a plain word
              beside the export it just looks like a second, unrelated button,
              and the first thing you do is press Export and get a file. Hence
              the icon and the caret. */}
          <div className="inline-flex rounded-md border dark:border-slate-700 overflow-hidden">
            <button
              type="button"
              onClick={exportCsv}
              disabled={csvSelection.length === 0}
              title={csvSelection.length ? t.analysis.exportHint : t.analysis.exportNoColumns}
              className="px-2 py-0.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 disabled:hover:bg-transparent"
            >
              {t.analysis.exportCsv}
            </button>
            <button
              type="button"
              onClick={() => setPickingColumns(c => !c)}
              aria-pressed={pickingColumns}
              aria-expanded={pickingColumns}
              title={t.analysis.csvColumnsHint}
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs border-l dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 ${pickingColumns ? "bg-slate-100 dark:bg-slate-800" : ""
              }`}
            >
              <Columns3 className="w-3 h-3" aria-hidden />
              {t.analysis.csvColumns}
              {/* The count is the tell that this button decides what the export
                  contains, not just how it looks. */}
              <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                {csvSelection.length}
              </span>
              <ChevronDown
                className={`w-3 h-3 transition-transform ${pickingColumns ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>
          </div>
          {/* Quick wins vs biggest prizes. The right answer genuinely differs
              by campaign, so it is a control rather than a constant. */}
          <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            <span>{t.analysis.balanceQuick}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={balance}
              onChange={e => pickBalance(Number(e.target.value))}
              title={t.analysis.balanceHint(
                Math.round(weightsFor(balance, formula.min_weight).wv / 2 * 100),
              )}
              className="w-24 accent-slate-900 dark:accent-slate-100"
            />
            <span>{t.analysis.balanceVolume}</span>
          </label>
          <span className="text-xs text-slate-600 dark:text-slate-400">{t.analysis.depthLabel}</span>
          <div className="inline-flex rounded-md border dark:border-slate-700 overflow-hidden">
            {DEPTHS.map(d => (
              <button
                key={d}
                type="button"
                onClick={() => pickDepth(d)}
                aria-pressed={depth === d}
                className={`px-2 py-0.5 text-xs border-l first:border-l-0 dark:border-slate-700 ${depth === d ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                {d === 0 ? t.analysis.depthAll : t.analysis.depthOption(d)}
              </button>
            ))}
          </div>
          {analysis.ahrefs_units != null && (
            <span className="text-xs text-slate-600 dark:text-slate-400 pl-1">
              {t.analysis.units(analysis.ahrefs_units)}
            </span>
          )}
          {/* A cheap run and a cached run show the same unit count; only this
              says which one you are looking at, and therefore how old the
              metrics beside it are. */}
          {(analysis.ahrefs_cached ?? 0) > 0 && (
            <span
              className="text-xs text-emerald-700 dark:text-emerald-300"
              title={t.analysis.ahrefsCacheHint(
                analysis.ahrefs_cached ?? 0,
                analysis.ahrefs_fetched ?? 0,
                ahrefsTtlDays,
              )}
            >
              {t.analysis.ahrefsCache(
                analysis.ahrefs_cached ?? 0, analysis.ahrefs_fetched ?? 0,
              )}
            </span>
          )}
          {/* The dollar figure alone says nothing without a denominator: the
              charge is mostly a fixed per-REQUEST fee, so the same $0.12 is
              $0.06 a domain over two and $0.0018 over two hundred. A cached run
              genuinely spent nothing, which is what makes this affordable on a
              schedule. */}
          {analysis.whois_enabled && analysis.whois_cost != null && (
            <span className="text-xs text-slate-600 dark:text-slate-400" title={whoisHint}>
              {whoisSummary}
            </span>
          )}
        </div>
      </div>
      {editingFormula && (
        <div className="px-4 py-3 border-b dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 space-y-3">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-sm">{t.formula.runTitle}</span>
            <span className={`text-xs ${isOverride ? "text-amber-700 dark:text-amber-300" : "text-slate-600 dark:text-slate-400"}`}>
              {isOverride ? t.formula.runOverridden : t.formula.runInherited}
            </span>
            <button
              type="button"
              onClick={() => setEditingFormula(false)}
              className="ml-auto text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
            >
              {t.common.cancel}
            </button>
          </div>
          {/* Edits re-score the table live, before anything is saved — the
              only way to judge a weighting is to watch the ranking move. */}
          <FormulaEditor
            value={formula}
            defaults={analysis.formula_global}
            onChange={setFormula}
            disabled={savingFormula}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={saveRunFormula}
              disabled={savingFormula}
              className="px-3 py-1 text-xs rounded-md bg-slate-900 text-white dark:bg-white dark:text-slate-900 disabled:opacity-50"
            >
              {t.formula.runSaveOverride}
            </button>
            {isOverride && (
              <button
                type="button"
                onClick={clearRunFormula}
                disabled={savingFormula}
                className="px-3 py-1 text-xs rounded-md border dark:border-slate-700 disabled:opacity-50"
              >
                {t.formula.runClearOverride}
              </button>
            )}
          </div>
        </div>
      )}
      {pickingColumns && (
        <CsvColumnPicker
          metrics={analysis.metrics}
          overrides={csvColumns}
          onChange={pickCsvColumns}
          onClose={() => setPickingColumns(false)}
        />
      )}
      {pasting && (
        <VolumePastePanel
          runKeywords={analysis.rows.map(r => r.keyword)}
          market={market}
          onApply={applyVolumes}
          onClose={() => setPasting(false)}
        />
      )}
      {(missingAi > 0 || scoring) && (
        <div className="px-4 py-2 border-b dark:border-slate-800 bg-amber-50 dark:bg-amber-950/30 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-amber-900 dark:text-amber-200">
            {t.analysis.aiMissing(analysis.rows.length - missingAi, analysis.rows.length)}
          </span>
          <span className="text-amber-800/80 dark:text-amber-200/70">
            {t.analysis.aiRescoreHint}
          </span>
          <button
            type="button"
            onClick={rescoreAi}
            disabled={scoring}
            className="ml-auto px-2 py-0.5 rounded-md border border-amber-400 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-60"
          >
            {scoring ? t.analysis.aiRescoring : t.analysis.aiRescore(missingAi)}
          </button>
        </div>
      )}
      {otherMarkets.length > 0 && (
        <div className="px-4 py-2 border-b dark:border-slate-800 text-xs text-amber-700 dark:text-amber-300">
          {t.analysis.volumeMultiCountry(market, otherMarkets.join(", "))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white dark:bg-slate-900">
            <tr className="border-b dark:border-slate-800 text-left">
              <th className={th} onClick={() => toggle("keyword")}>
                {t.analysis.colKeyword}{arrow("keyword")}
              </th>
              {/* The ladder is a picture; there is nothing to order it by that
                  the Soft slots column does not already carry. */}
              <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-400">
                {t.analysis.colShape}
              </th>
              {analysis.metrics.map(m => (
                <th key={m} className={`${th} text-right`} onClick={() => toggle(m)}>
                  {METRIC_LABELS[m] ?? m}{arrow(m)}
                </th>
              ))}
              <th className={`${th} text-right`} onClick={() => toggle("soft")}>
                {t.analysis.colSoft}{arrow("soft")}
              </th>
              <th
                className={`${th} text-right`}
                onClick={() => toggle("volume")}
                title={
                  analysis.sub_national
                    ? t.analysis.volumeCityHint(market)
                    : t.analysis.volumeGeoNote(market)
                }
              >
                {t.analysis.colVolume(market)}{arrow("volume")}
              </th>
              <th className={`${th} text-right`} onClick={() => toggle("coverage")}>
                {t.analysis.colCoverage}{arrow("coverage")}
              </th>
              <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-400 text-right">
                {t.analysis.colDifficulty}
              </th>
              <th className={`${th} text-right`} onClick={() => toggle("opportunity")}>
                {t.analysis.colOpportunity}{arrow("opportunity")}
              </th>
              <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-400">
                {t.analysis.colComment}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(view => (
              <AnalysisTableRow
                key={view.row.keyword}
                view={view}
                metrics={analysis.metrics}
                domainMetrics={analysis.domain_metrics}
                depth={depth}
                driver={driver}
                ceiling={ceiling}
                rankerLabel={rankerLabel}
                showWhois={analysis.whois_enabled}
                subNational={analysis.sub_national}
                shortlist={formula.shortlist}
                formula={formula}
                onSaveVolume={saveVolume}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 border-t dark:border-slate-800 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
        <span>{t.analysis.legendTitle}</span>
        {(["soft", "propped", "moderate", "strong", "unknown"] as Band[]).map(b => (
          <span key={b} className="inline-flex items-center gap-1" title={t.analysis.bandHints[b]}>
            <span className={`inline-block w-2 h-2 rounded-sm ${BAND_BAR[b]}`} />
            {t.analysis.bandLabels[b]}
          </span>
        ))}
      </div>
      <div className="px-4 py-2 border-t dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
        {t.analysis.footnote}
      </div>
    </div>
  );
}

function AnalysisTableRow({
  view, metrics, domainMetrics, depth, driver, ceiling, rankerLabel, showWhois,
  subNational, shortlist, formula, onSaveVolume,
}: {
  view: KeywordView;
  metrics: string[];
  domainMetrics: string[];
  depth: Depth;
  driver: string | null;
  ceiling: number;
  rankerLabel: string;
  showWhois: boolean;
  subNational: boolean;
  shortlist: number;
  formula: OpportunityFormula;
  onSaveVolume: (keyword: string, volume: number) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const { row, cohort, stats, bands, analysed, total, opp, rank } = view;
  const partial = analysed < total;
  const cohortPositions = positionsLabel(cohort.map(u => u.position).sort((a, b) => a - b));
  // Only the bands actually present, so the tooltip stays short on a SERP that
  // is all one colour.
  const bandBreakdown = (["soft", "propped", "moderate", "strong", "unknown"] as Band[])
    .filter(b => bands[b] > 0)
    .map(b => t.analysis.bandCount(b, bands[b]))
    .join(", ");
  // +8 = keyword, shape, soft, volume, coverage, difficulty, opportunity,
  // comment around the metric columns.
  const span = metrics.length + 8;
  return (
    <>
      <tr className="border-b dark:border-slate-800">
        <td className="px-3 py-2 font-medium break-all align-top">
          {/* Toggles the raw per-URL rows — the manual check on what Ahrefs
              actually returned for this keyword's SERP. */}
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="inline-flex items-center gap-1.5 text-left hover:underline"
            aria-expanded={open}
          >
            <span className={`text-slate-600 dark:text-slate-300 transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
            {row.keyword}
          </button>
        </td>
        <td className="px-3 py-2 align-top">
          <Ladder
            urls={row.urls}
            depth={depth}
            driver={driver}
            ceiling={ceiling}
            cohort={cohort}
            bands={formula}
          />
          {/* Naming the slots once, here, beats repeating them under every
              column — the cohort is the same for the whole row now. */}
          {cohort.length > 0 && (
            <div
              className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-1"
              title={t.analysis.cohortHint(cohort.length, rankerLabel)}
            >
              {t.analysis.cohortLabel(cohortPositions)}
            </div>
          )}
        </td>
        {metrics.map(m => {
          const stat = stats[m];
          // Ahrefs can return a record with some fields empty, so an average
          // may rest on fewer pages than the cohort holds. Say so rather than
          // passing a one-page figure off as a two-page one.
          const shortfall = stat != null && stat.value != null && stat.from < stat.of;
          return (
            <td
              key={m}
              className="px-3 py-2 text-right align-top"
              title={
                stat?.value != null
                  ? t.analysis.cellHint(
                      METRIC_LABELS[m] ?? m,
                      stat.from,
                      stat.of,
                      rankerLabel,
                      cohortPositions,
                    )
                  : undefined
              }
            >
              <div className="font-mono tabular-nums">
                {formatMetric(stat?.value)}
                {shortfall && <span className="text-amber-600 dark:text-amber-400">*</span>}
              </div>
            </td>
          );
        })}
        {/* Soft slots and coverage are separate questions — how winnable this
            SERP looks, versus how much of it we could measure at all — so they
            get separate columns rather than sharing one cell. */}
        <td
          className="px-3 py-2 text-right font-mono tabular-nums align-top"
          title={
            total === 0
              ? t.analysis.noneInDepth
              : t.analysis.softHint(bands.soft, total, bandBreakdown)
          }
        >
          {total === 0 ? (
            <span className="text-slate-500 dark:text-slate-400">—</span>
          ) : bands.soft > 0 ? (
            <span className="text-emerald-700 dark:text-emerald-300">{bands.soft}</span>
          ) : (
            <span className="text-slate-500 dark:text-slate-400">0</span>
          )}
        </td>
        <td className="px-3 py-2 text-right align-top">
          <VolumeCell
            keyword={row.keyword}
            volume={row.volume}
            country={row.volume_country}
            subNational={subNational}
            onSave={onSaveVolume}
          />
        </td>
        <td
          className={`px-3 py-2 text-right font-mono tabular-nums align-top ${partial ? "text-amber-700 dark:text-amber-300" : "text-slate-600 dark:text-slate-400"
          }`}
          title={
            total === 0
              ? t.analysis.noneInDepth
              : partial
                ? t.analysis.partialHint
                : t.analysis.coverageHint(analysed, total)
          }
        >
          {total === 0 ? (
            <span className="text-slate-500 dark:text-slate-400">—</span>
          ) : (
            `${analysed}/${total}`
          )}
        </td>
        <td className="px-3 py-2 text-right whitespace-nowrap align-top">
          {row.difficulty ? (
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${DIFFICULTY_STYLE[row.difficulty] ?? ""}`}>
              {t.analysis.difficultyLabels[row.difficulty] ?? row.difficulty}
            </span>
          ) : row.ai_error ? (
            <span className="text-xs text-red-600 dark:text-red-400" title={row.ai_error}>
              {t.analysis.aiFailed}
            </span>
          ) : (
            <span className="text-xs text-slate-500 dark:text-slate-400">{t.analysis.difficultyPending}</span>
          )}
        </td>
        <td
          className="px-3 py-2 text-right align-top whitespace-nowrap"
          title={
            opp.score == null
              ? t.analysis.oppNoVolume
              : t.analysis.oppHint(
                  Math.round((opp.volume ?? 0) * 100),
                  Math.round(opp.winnability * 100),
                  Math.round(opp.bar * 100),
                  Math.round(opp.soft * 100),
                  opp.ai,
                )
          }
        >
          {opp.score == null ? (
            <span className="text-xs text-slate-500 dark:text-slate-400">{t.analysis.oppNeedsVolume}</span>
          ) : (
            <>
              <span className={`font-mono tabular-nums ${scoreTone(rank, shortlist)}`}>
                {opp.score.toFixed(1)}
              </span>
              {/* The shortlist is the deliverable: mark it, don't make them
                  count rows. */}
              {rank != null && rank <= shortlist && (
                <span className="ml-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                  #{rank}
                </span>
              )}
            </>
          )}
        </td>
        <td className="px-3 py-2 text-slate-600 dark:text-slate-300 min-w-[16rem] align-top">
          {row.comment || <span className="text-slate-500 dark:text-slate-400">—</span>}
        </td>
      </tr>
      {open && (
        <tr className="border-b dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
          <td colSpan={span} className="px-3 py-2">
            <div className="text-xs text-slate-600 dark:text-slate-400 mb-1">{t.analysis.rawTitle}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-600 dark:text-slate-400">
                    <th className="px-2 py-1 font-medium">{t.analysis.colPos}</th>
                    <th className="px-2 py-1 font-medium">URL</th>
                    {metrics.map(m => (
                      <th key={m} className="px-2 py-1 font-medium text-right">
                        {METRIC_LABELS[m] ?? m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {row.urls.map(u => {
                    const band: Band = driver
                      ? bandOf(u.metrics, u.analysed, driver, formula)
                      : "unknown";
                    // Everything below the selected depth is context, not a
                    // competitor for the slot you are aiming at.
                    const inDepth = depth === 0 || u.position <= depth;
                    const picked = cohort.some(c => c.position === u.position);
                    return (
                      <tr
                        key={`${u.position}-${u.url}`}
                        className={`border-t dark:border-slate-800 ${inDepth ? "" : "opacity-50"} ${
                          picked ? "bg-slate-100/70 dark:bg-slate-800/50" : ""
                        }`}
                      >
                        <td className="px-2 py-1 font-mono whitespace-nowrap">
                          <span
                            className={`inline-block w-1.5 h-1.5 rounded-sm mr-1.5 align-middle ${BAND_BAR[band]}`}
                            title={t.analysis.bandHints[band]}
                          />
                          {u.position}
                          {/* The rows the headline numbers were averaged from. */}
                          {picked && (
                            <span
                              className="ml-1.5 text-xs uppercase tracking-wide text-slate-600 dark:text-slate-400"
                              title={t.analysis.cohortHint(cohort.length, rankerLabel)}
                            >
                              {t.analysis.inCohort}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <a
                            href={u.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-700 dark:text-blue-300 hover:underline break-all font-mono"
                          >
                            {u.url}
                          </a>
                          {/* Never hide that we measured a different URL than the
                              one that ranked. */}
                          {u.normalized && (
                            <div className="text-slate-600 dark:text-slate-400 break-all">
                              {t.analysis.analyzedAs}{" "}
                              <span className="font-mono">{u.analyzed_url}</span>
                            </div>
                          )}
                          {u.positions.length > 1 && (
                            <span className="ml-2 text-slate-600 dark:text-slate-400">
                              {t.analysis.alsoAt(
                                positionsLabel(u.positions.filter(p => p !== u.position)),
                              )}
                            </span>
                          )}
                          {!u.analysed && (
                            <span className="ml-2 text-amber-700 dark:text-amber-300">
                              {t.analysis.notAnalysed}
                            </span>
                          )}
                          {u.error && (
                            <span className="ml-2 text-red-600 dark:text-red-400">
                              {t.analysis.fetchFailed}
                            </span>
                          )}
                        </td>
                        {metrics.map(m => (
                          <td key={m} className="px-2 py-1 text-right font-mono tabular-nums">
                            {formatMetric(u.metrics[m])}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <DomainSubTable row={row} metrics={domainMetrics} showWhois={showWhois} />
            <PromptInspector row={row} />
          </td>
        </tr>
      )}
    </>
  );
}
