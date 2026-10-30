"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";

export type Lang = "en" | "ru";

const STORAGE_KEY = "lang";

// Russian three-form plural selector (one / few / many).
function pluralRu(n: number, [one, few, many]: [string, string, string]): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const messagesEn = {
  appName: "SERP Monitor",
  langName: { en: "EN", ru: "RU" },
  langSwitchTitle: "Language",
  themeSwitchToLight: "Switch to light mode",
  themeSwitchToDark: "Switch to dark mode",
  common: {
    loading: "Loading…",
    cancel: "Cancel",
    save: "Save",
    saved: "Saved.",
    cleared: "Cleared.",
    test: "Test",
    clear: "Clear",
    edit: "Edit",
    open: "Open",
    rename: "Rename",
    delete: "Delete",
    add: "Add",
    import: "Import",
    copy: "Copy",
    copyAll: "Copy all",
    download: "Download",
    filter: "Filter…",
    yourTime: "your time",
    close: "Close",
    optional: "(optional)",
  },
  nav: {
    jobs: "Jobs",
    projects: "Projects",
    newJob: "New job",
    settings: "Settings",
    docs: "Документация",
  },
  home: {
    title: "Jobs",
    newJob: "+ New job",
    searchPlaceholder: "Search by name or keyword…",
    allProjects: "All projects",
    ungrouped: "No project",
    noMatches: "Nothing matches that search.",
    showing: (from: number, to: number, total: number) =>
      `${from}–${to} of ${total}`,
    prev: "← Previous",
    next: "Next →",
    empty: "No jobs yet. Create your first one.",
    run: "Run",
    renamePrompt: "New name?",
    deleteConfirm: (name: string) => `Delete "${name}" and all its runs?`,
    kwCount: (n: number) => `${n} kw`,
    locCount: (n: number) => `${n} location(s)`,
    langCount: (n: number) => `${n} lang(s)`,
  },
  jobs: {
    newTitle: "New job",
    editPrefix: (name: string) => `Edit: ${name}`,
    runNow: "Run now",
    fields: {
      provider: "Provider",
      providers: "Providers",
      keywords: "Keywords",
      engines: "Engines",
      devices: "Devices",
      languages: "Languages",
      locations: "Locations",
      googleDomains: "Google domains",
      topN: "Top N",
      schedule: "Schedule",
    },
    keywordsCount: (n: number) => `${n} keyword(s)`,
    autoFallback: "auto",
    runs: "Runs",
    noRuns: "No runs yet.",
    totalCost: (total: string, n: number) =>
      `${total} total across ${n} run${n === 1 ? "" : "s"}`,
    runEntry: {
      runLabel: (id: number) => `Run #${id}`,
      progress: (done: number, total: number) => `${done}/${total} done`,
      failed: (n: number) => `${n} failed`,
    },
    schedule: {
      enabled: "enabled",
      disabled: "disabled",
      cronInTz: (tz: string) => <>cron is in <strong>{tz}</strong></>,
      notRegistered: "⚠ not registered with scheduler — try toggling and saving again",
      nextRun: (when: string) => <>Next run: <strong>{when}</strong> (your time)</>,
    },
    statusBadge: {
      pending: "pending",
      running: "running",
      done: "done",
      failed: "failed",
      canceled: "canceled",
    },
  },
  report: {
    open: "Report",
    title: "SERP opportunity report",
    subtitle: (market: string, date: string) => `${market} · ${date}`,
    lang: "Report language",
    download: "Download PDF",
    downloading: "Building PDF…",
    filename: (job: string, run: number) => `${job || "report"}-run${run}.pdf`,
    page: (current: number, total: number) => `${current} / ${total}`,
    controls: "Report settings",
    summary: "Summary",
    analysed: "Keywords analysed",
    shortlisted: "Keywords selected",
    reachableVolume: "Monthly searches in the shortlist",
    shortlistTitle: "Where to start",
    shortlistLead: (n: number) =>
      `The ${n} keywords with the best ratio of demand to how winnable the SERP looks.`,
    colRank: "#",
    colKeyword: "Keyword",
    colVolume: "Volume",
    colDifficulty: "SERP difficulty",
    colBar: "Entry bar",
    colBarRd: "Entry bar (ref. domains)",
    colSoft: "Soft slots",
    colScore: "Potential",
    // Three of the seven columns are our own constructs rather than figures the
    // reader has met before, and the report is read without us in the room.
    legendDifficulty:
      "the AI verdict on the SERP as a whole — who holds the top slots and how strong those pages are.",
    legendBar: (depth: number) =>
      (depth === 0
        ? "the average DR of the weakest domains in the SERP"
        : `the average DR of the weakest domains in the top ${depth}`) +
      " — the level you need to reach to compete for a slot.",
    legendBarRd:
      "the same bar in referring domains, averaged over the same weakest competitors — roughly how many linking domains it takes to compete here.",
    legendScore:
      "0-100. Demand weighted against how winnable the SERP looks, so the top of this list is where to start.",
    detailTitle: "Keyword detail",
    competitors: "Who you would have to displace",
    noDomains: "No domains selected for this keyword.",
    aiComment: "Analyst comment",
    colDomain: "Domain",
    colAge: "Age",
    colBacklinks: "Backlinks",
    colRefdomains: "Ref. domains",
    colKeywordsTop: "Keywords in top 3",
    colKeywords410: "Keywords 4-10",
    keywordPicker: "Keywords in the report",
    domainPicker: "Domains shown",
    domainPickerHint:
      "Unticked domains are hidden from every table. Majors like youtube and wikipedia are usually noise here.",
    inKeywords: (n: number) => `${n} kw`,
    selectAll: "All",
    selectNone: "None",
    footer: (job: string, run: number) => `${job} · run #${run}`,
    empty: "Nothing to report — no keyword in this run has both a volume and a verdict.",
  },
  aiTuning: {
    tuningTitle: "Model tuning",
    tuningHelp:
      "How the difficulty judge samples. Measured on a real SERP with an identical prompt, 8 samples per setting.",
    temperature: "Creativity (temperature)",
    temperatureHelp:
      "Measured: no material effect. The verdict split the same way at 0.0 and at 1.5, and the wording was freshly phrased at every setting — so raising it does not add variety and lowering it does not add determinism.",
    thinking: "Reasoning budget (tokens)",
    thinkingHelp:
      "Measured: this is the setting that matters. At 0 the judge called this SERP medium 7 times in 8; at 1024 it called it hard 8 times out of 8, correctly weighing that parasite pages on DR-77 news domains are hard to displace despite empty link profiles. Costs about 3x the completion tokens. 0 turns thinking off.",
    maxTokens: "Answer cap (tokens)",
    maxTokensHelp:
      "Thinking is billed against this same allowance, so the cap is raised automatically to keep room for the answer. Set it too low with thinking on and the model spends everything reasoning and returns nothing.",
  },
  formula: {
    title: "Opportunity formula",
    subtitle:
      "How keywords in a run are ranked. Set the defaults here; any run can override them.",
    equation:
      "Opportunity = (Volume^wv × Winnability^ww)^½ · Winnability = Bar × Soft × AI",
    groups: {
      difficulty: "SERP difficulty",
      slots: "Slot strength",
      winnability: "Entry bar",
      ranking: "Ranking",
    } as Record<string, string>,
    groupHints: {
      difficulty: "What each AI verdict multiplies winnability by. A multiplier, not an addend — so a verdict can veto a SERP the numbers call easy.",
      slots: "Where a slot stops being soft and starts being strong. Drives both the ladder's colours and the soft-slot count.",
      winnability: "How the weakest competitors and the soft slots turn into a winnability figure.",
      ranking: "How volume and winnability combine into the final score.",
    } as Record<string, string>,
    labels: {
      ai_low: "AI: low",
      ai_medium: "AI: medium",
      ai_hard: "AI: hard",
      ai_too_hard: "AI: too hard",
      ai_unknown: "AI: no verdict",
      bar_dr_ceiling: "Entry-bar DR ceiling",
      soft_floor: "Soft-slot floor",
      min_weight: "Minimum weight",
      balance: "Default balance",
      shortlist: "Shortlist size",
      ur_soft: "Soft slot: UR below",
      ur_strong: "Strong slot: UR at or above",
      dr_soft: "Weak domain: DR below",
      dr_strong: "Strong domain: DR at or above",
      volume_curve: "Volume curve",
    } as Record<string, string>,
    hints: {
      ai_low: "Multiplier when the judge says a SERP is winnable",
      ai_medium: "Multiplier for a medium verdict",
      ai_hard: "Multiplier for a hard verdict",
      ai_too_hard: "Set to 0 to exclude these keywords outright",
      ai_unknown: "Used when the AI never scored the keyword",
      bar_dr_ceiling: "DR at which a SERP counts as closed. Lower = stricter",
      soft_floor: "Lowest the soft-slot factor can go. 1 disables it",
      min_weight: "Stops either factor dropping out at the slider extremes",
      balance: "Where the quick-wins ↔ big-prizes slider starts",
      shortlist: "How many top keywords get highlighted",
      ur_soft: "A page below this has essentially no links of its own",
      ur_strong: "At or above this the page is genuinely well linked",
      dr_soft: "An empty page below this DR is soft; above it, domain-carried",
      dr_strong: "Only used when DR drives the ladder instead of UR",
      volume_curve: "sqrt tempers big keywords · linear lets them dominate · log flattens hardest",
    } as Record<string, string>,
    revertTo: (v: string) => `Revert to ${v}`,
    resetGlobal: "Reset to built-in defaults",
    runTitle: "Formula for this run",
    runInherited: "Following the global formula",
    runOverridden: "⚠ This run overrides the global formula",
    runSaveOverride: "Save for this run",
    runClearOverride: "Use global",
    edit: "Formula",
  },
  analysis: {
    title: "SERP analysis",
    subtitle: (depth: number, ranker: string) =>
      depth === 0
        ? `Entry bar across the whole SERP — the weakest domains by ${ranker}, averaged`
        : `Entry bar for the top ${depth} — the weakest domains by ${ranker}, averaged`,
    depthLabel: "Aiming for",
    depthOption: (n: number) => `Top ${n}`,
    depthAll: "All",
    colKeyword: "Keyword",
    colShape: "SERP shape",
    colSoft: "Soft slots",
    colVolume: (market: string) => (market ? `Volume (${market})` : "Volume"),
    volumeGeoNote: (market: string) =>
      `Country-wide (${market}) — keyword tools report volume per country, not per city`,
    volumeCityHint: (market: string) =>
      `This run was targeted at a city or region, but search volume is only ever reported per country. The figure is ${market}-wide: the city is the vantage point the SERP was measured from, not the size of the market.`,
    volumeMultiCountry: (used: string, others: string) =>
      `⚠ This run spans ${others} as well as ${used}. Scores price demand in ${used} only — the other markets are not counted.`,
    colOpportunity: "Opportunity",
    colCoverage: "Analysed",
    colDifficulty: "SERP difficulty",
    colComment: "AI comment",
    difficultyPending: "—",
    difficultyLabels: {
      low: "low",
      medium: "medium",
      hard: "hard",
      "too hard": "too hard",
    } as Record<string, string>,
    aiFailed: "AI failed",
    aiMissing: (judged: number, total: number) =>
      `${judged} of ${total} keywords have an AI verdict.`,
    aiRescoreHint:
      "The SERP, the Ahrefs metrics and the domain ages are already stored — scoring the rest costs AI tokens only, nothing is re-scraped or re-billed.",
    aiRescore: (n: number) => `Score the remaining ${n}`,
    aiRescoring: "Scoring…",
    empty: "No analysis yet. Run this job to collect Ahrefs metrics.",
    units: (n: number) => `${n.toLocaleString()} Ahrefs units`,
    ahrefsCache: (cached: number, fetched: number) =>
      cached > 0 ? `· ${cached} of ${cached + fetched} from cache` : "",
    ahrefsCacheHint: (cached: number, fetched: number, ttl: number) =>
      `${cached} target(s) were already measured within the last ${ttl} day(s) and reused; ${fetched} were bought. Ahrefs metrics move, so the cached figures are up to ${ttl} day(s) old — shorten the TTL in Settings if you are watching day-to-day movement.`,
    partialHint: "Some URLs in this depth could not be analysed",
    cellHint: (metric: string, from: number, of: number, ranker: string, positions: string) =>
      from < of
        ? `Mean ${metric} of ${positions} — the ${of} weakest domains by ${ranker}. Only ${from} of them reported this metric.`
        : `Mean ${metric} of ${positions} — the ${of} weakest domains by ${ranker}`,
    cohortLabel: (positions: string) => `weakest: ${positions}`,
    cohortHint: (size: number, ranker: string) =>
      `The ${size} weakest domains by ${ranker} in this depth, one page each — every figure in this row is their average`,
    inCohort: "averaged",
    bandCount: (band: string, n: number) =>
      `${n} ${({
        soft: "soft",
        propped: "domain-carried",
        moderate: "moderate",
        strong: "strong",
        unknown: "unknown",
      } as Record<string, string>)[band] ?? band}`,
    softHint: (soft: number, total: number, breakdown: string) =>
      `${soft} of ${total} slots are weak pages on weak domains — the realistic targets. Full split: ${breakdown}`,
    coverageHint: (analysed: number, total: number) =>
      `Ahrefs returned metrics for ${analysed} of the ${total} pages in this depth`,
    exportCsv: "Export table",
    exportHint: "Download these rows as CSV, at the depth shown",
    exportNoColumns: "Pick at least one column to export",
    csvColumns: "Columns",
    csvColumnsTitle: "Columns to export",
    csvColumnsHint:
      "Ticked columns go into the CSV. The header row at the bottom shows the exact order they are written in. The choice is remembered across runs; a metric a later run adds is exported unless you untick it.",
    csvSelectAll: "All",
    csvSelectDefault: "Default",
    csvSelectNone: "None",
    csvSelected: (on: number, all: number) => `${on} of ${all}`,
    csvHeaderPreview: "Header row",
    csvGroupLabels: {
      keyword: "Keyword & volume",
      score: "Opportunity",
      shape: "SERP shape",
      metrics: "Entry bar",
      slots: "Slots",
      ai: "AI verdict",
    } as Record<string, string>,
    csvColumnLabels: {
      keyword: "Keyword",
      opportunity: "Opportunity score",
      opportunity_rank: "Rank in shortlist",
      volume: "Volume",
      volume_country: "Volume country",
      winnability: "Winnability",
      depth: "Depth exported",
      cohort_size: "Cohort size",
      ranked_by: "Cohort ranked by",
      cohort_positions: "Cohort positions",
      cohort_domains: "Cohort domains",
      soft_slots: "Soft slots",
      domain_carried_slots: "Domain-carried slots",
      moderate_slots: "Moderate slots",
      strong_slots: "Strong slots",
      slots_analysed: "Slots analysed",
      slots_total: "Slots total",
      ai_difficulty: "SERP difficulty",
      ai_comment: "AI comment",
    } as Record<string, string>,
    // Deliberately long. "UR: pages averaged" reads as "UR, averaged over the
    // pages" — which is what the column BESIDE it is — and gets ticked by
    // mistake. Say "how many" so it cannot be read as a rating.
    csvMetricAverage: (metric: string) => `${metric} — cohort average`,
    csvPagesAveraged: (metric: string) => `${metric} — how many pages averaged`,
    balanceQuick: "quick wins",
    balanceVolume: "big prizes",
    balanceHint: (pct: number) =>
      `Opportunity = weighted geometric mean of volume and winnability. ` +
      `Volume weight ${pct}%, winnability ${100 - pct}%. Left favours SERPs you can take quickly; right favours the biggest traffic you could plausibly win.`,
    volumeAdd: "+ add",
    pasteVolumes: "Paste volumes",
    pasteTitle: "Paste volumes from Ahrefs",
    pasteHelp: (market: string) =>
      `Copy the rows straight out of Keywords Explorer or a CSV export — header included. Saved for ${market || "this run's market"}.`,
    pastePlaceholder: `Keyword	Country	Difficulty	Volume	CPC
melbet	kz	34	20,000	0.45`,
    pasteColumns: (kw: string, vol: string) =>
      `Reading “${kw}” as the keyword and “${vol}” as the volume.`,
    pasteNoHeader:
      "No header row found — reading each line as “keyword … number”. Paste the header too if a column gets misread.",
    pasteWrongCountry: (found: string, market: string) =>
      `⚠ This paste is for ${found}, but the run's market is ${market}. Ahrefs volumes are per country — check you exported the right one.`,
    pasteMatched: (n: number) => `${n} keyword(s) ready to save.`,
    pasteUnmatched: (n: number, names: string) =>
      `${n} not in this run, so they'll be ignored: ${names}`,
    pasteSkipped: (n: number) => `${n} line(s) had no usable number and were skipped.`,
    pasteMissing: (n: number, names: string) =>
      `${n} keyword(s) in this run still have no volume: ${names}`,
    pasteApply: (n: number) => (n ? `Save ${n} volume(s)` : "Nothing to save"),
    volumeEmpty: "No volume entered — this keyword can't be scored. Click to add one.",
    volumeAnyCountry: "any country",
    volumeHint: (country: string) =>
      `Monthly searches (${country}). Stored per keyword and reused by every run in this market — click to edit.`,
    oppNeedsVolume: "needs volume",
    oppNoVolume: "Enter a search volume to score this keyword",
    oppHint: (vol: number, win: number, bar: number, soft: number, ai: number) =>
      `Volume ${vol}% of the run's largest · winnability ${win}% ` +
      `(entry bar ${bar}% × soft slots ${soft}% × AI verdict ×${ai}). ` +
      `Scores are relative to this run, so they answer "which of these first", not "is this good".`,
    noneInDepth: "No results in this depth",
    bandLabels: {
      soft: "soft",
      propped: "domain-carried",
      moderate: "moderate",
      strong: "strong",
      unknown: "unknown",
    } as Record<string, string>,
    bandHints: {
      soft: "Weak page on a weak domain — the realistic target",
      propped: "Page has no links of its own, but sits on a strong domain",
      moderate: "Page has some link equity behind it",
      strong: "Genuinely well-linked page",
      unknown: "Not analysed",
    } as Record<string, string>,
    gapHint: (pos: number) =>
      `#${pos} — no organic result here (an ad or a SERP feature took the slot)`,
    legendTitle: "Bar height = page strength · colour =",
    promptTitle: "Prompt sent to the AI",
    promptHint:
      "Exactly what the model received for this keyword, recorded before the call. Includes the SERP table, the metrics and the domain section.",
    promptMeta: (model: string, inTok: number | null, outTok: number | null) =>
      [model, inTok != null ? `${inTok.toLocaleString()} in` : null,
       outTok != null ? `${outTok.toLocaleString()} out` : null]
        .filter(Boolean).join(" · "),
    promptCopy: "Copy prompt",
    promptCopied: "Copied",
    promptNone:
      "No prompt recorded — this run predates prompt logging. Re-run the job to capture it.",
    promptResponse: "Model reply",
    rawTitle: "Raw Ahrefs data for every URL in this SERP",
    rawDomainTitle: "Domain-level metrics for the sites above",
    colDomain: "Domain",
    colAge: "Age",
    colRegistrar: "Registrar",
    ageHint: (created: string, registrable: string) =>
      `Registered ${created} (${registrable})`,
    ageSubdomainHint: (created: string, registrable: string) =>
      `Subdomain — this is the age of ${registrable}, registered ${created}`,
    ageUnknownHint: "No registration record found — neither RDAP nor DataForSEO has this domain",
    ageNoDateHint:
      "A registration record exists, but its registry does not publish a creation date. Common for some ccTLDs — this is not a new domain, its age is simply unknown.",
    whoisSpend: (usd: string, perDomain: string) => `WHOIS ${usd} · ${perDomain}/domain`,
    whoisCached: "WHOIS cached · free",
    whoisSpendHint: (fetched: number, cached: number, usd: string, perDomain: string) =>
      `${fetched} domain(s) looked up${cached ? `, ${cached} already cached` : ""}. ` +
      `DataForSEO bills a fixed ~$0.12 per request plus ~$0.0012 per domain, so ${usd} ` +
      `works out at ${perDomain} per domain at this size. The fee is per REQUEST, not ` +
      `per domain — the more domains share one call, the cheaper each gets.`,
    whoisCachedHint: (domains: number) =>
      `All ${domains} domain(s) answered from cache — registration dates don't change, so a recurring job pays only for domains it has never seen.`,
    colPos: "#",
    alsoAt: (positions: string) => `also at ${positions}`,
    analyzedAs: "analysed as",
    notAnalysed: "not analysed",
    fetchFailed: "fetch failed",
    footnote:
      "Every figure in a row is the average of the SAME weakest competitors — two of them at a bounded depth, three across the whole SERP, listed under the bars and dotted in them. More than one, because a single weakest page is a coin flip; ranked by DR rather than per metric, because a per-metric minimum picks a different page in each column and lets an authority domain with an empty page profile define the “easiest” backlink target, which it is not. One page per domain: DR belongs to the site, so a site holding two slots would otherwise fill the cohort with itself. Only analysed pages are eligible, and an asterisk means the average rests on fewer pages than the cohort holds. URLs are analysed in Ahrefs exact-URL mode, which is what makes UR per-page rather than per-domain; AMP and tracking variants are normalised to the canonical page first, because Ahrefs reports those as separate URLs with an empty link profile. When a keyword spans several engines, devices or locations, a page is placed at its BEST slot. Click a keyword to see the raw per-URL numbers.",
  },
  projects: {
    // The project page's tabs.
    tabs: { overview: "Overview", positions: "Positions", blocks: "Blocks", uploads: "CSV uploads" },
    title: "Projects",
    lead: "A project holds the domains you are watching for a client or site. It is also the folder the jobs list groups by — assign a job to a project and it files itself there.",
    newProject: "New project",
    newJob: "New job",
    viewJobs: "Jobs",
    create: "Create project",
    empty: "No projects yet. Create one to group your jobs and keep the domains you track.",
    name: "Project name",
    namePlaceholder: "e.g. Acme Casino — KZ",
    nameRequired: "A name is required.",
    domains: "Domains",
    domainsHint: "(paste any format — one per line, commas, or full URLs)",
    domainsPlaceholder: "example.com\nhttps://www.example.kz/promo\nkz.example.com",
    domainsCount: (n: number) => `${n} domain(s)`,
    domainsDuplicates: (n: number) => `${n} duplicate(s) dropped`,
    domainsRejected: (n: number, sample: string) =>
      `${n} entr${n === 1 ? "y" : "ies"} not recognised as a domain, and will not be saved: ${sample}`,
    notes: "Notes",
    jobsCount: (n: number) => `${n} job(s)`,
    andMore: (n: number) => `+${n} more`,
    showAllDomains: (n: number) => `+${n} more — show all`,
    showFewerDomains: "show fewer",
    deleteConfirm: (name: string, jobs: number) =>
      jobs > 0
        ? `Delete the project "${name}"? Its ${jobs} job(s) are kept — they become ungrouped, with their runs and schedules intact.`
        : `Delete the project "${name}"?`,
  },
  positions: {
    title: "Positions",
    allProjects: "All projects",
    presets: {
      today: "Today",
      yesterday: "Yesterday",
      week: "This week",
      month: "This month",
      year: "This year",
      custom: "Custom",
    } as Record<string, string>,
    badRange: "Pick both dates — the end cannot be before the start.",
    tracking: {
      toggle: "Position Tracking",
      toggleHint: "A rank tracker's view: how many positions are in each top N, and every URL of the project's with its best and average position and how it moved.",
      overview: "Overview",
      distribution: "Position distribution",
      distributionAbout:
        "How many of the project's positions are in each band of places, at the latest check of every keyword in the period. Each column is its own band (Top 3 is #2–3), so a position is counted once. A keyword where three of the project's sites rank counts three times.",
      againstCheck: "Change against each keyword's previous check.",
      noCheck: "None of these keywords was checked before, so there is nothing to compare with.",
      againstPeriod: (since: string) => `Change against the previous period (${since}).`,
      noPeriod: "Nothing was checked in the previous period, so there is nothing to compare with.",
      beforeCheck: (n: number) => `At the previous checks: ${n}`,
      dropped: "Keywords that dropped out",
      droppedAbout:
        "How many keywords had a URL of the project's in each band of places that is not on the page at all now — a URL that only moved down is not counted. Each column is its own band (Top 3 is #2–3), so a URL is counted once, where it was. Off the page means as deep as the checks read it. Hover a number for the keywords and URLs.",
      band: (from: number, to: number) => (from === to ? `#${to}` : `#${from}–${to}`),
      droppedLine: (keyword: string, url: string, was: number) => `${keyword} — ${url} (was #${was})`,
      droppedAgainstCheck: "Against each keyword's previous check.",
      droppedAgainstPeriod: (since: string) => `Against the previous period (${since}).`,
      droppedNone: "None of these keywords can be compared, so nothing can be said.",
      droppedList: (keywords: string[], more: number) => keywords.join("\n") + (more > 0 ? `\n… and ${more} more` : ""),
      serpCol: "Search engine · GEO",
      keywordsCol: "Keywords",
      top: (n: number) => `Top ${n}`,
      beyondDepth: (depth: number) => `The checks of this SERP reach position ${depth} only, so this column cannot count further than that.`,
      before: (n: number) => `Previous period: ${n}`,
      filters: "Filters",
      engine: "Search engine",
      geo: "GEO",
      position: "Position",
      change: "Change",
      compare: "Compare with",
      compareCheck: "the previous check",
      compareCheckHint: "The check of the keyword before its latest one — even from before the period.",
      comparePeriod: "the previous period",
      comparePeriodHint: (since: string) => `The latest check of the keyword in the previous period (${since}).`,
      all: "All",
      changeKinds: { up: "Improved", down: "Declined", same: "Unchanged", new: "New", lost: "Dropped out", none: "No comparison" } as Record<string, string>,
      search: "Find a keyword or URL…",
      col: { keyword: "Keyword", cluster: "Cluster", geo: "GEO", engine: "Search engine", position: "Latest", best: "Best", average: "Average", trend: "Trend", change: "Change" },
      export: "Export CSV",
      exportHint: "Download the whole table as CSV — every URL, whatever the filters above, in the table's order",
      exportOptions: "Choose what to export",
      exportGeoEngine: "GEO and search engine",
      exportPosition: "Position (latest)",
      exportBand: (n: number, from: number) => (from === n ? `Top ${n} (#${n})` : `Top ${n} (#${from}–${n})`),
      exportNone: "Not on the page",
      exportChange: "Change",
      exportCompare: (what: string) => `Measured against ${what}, as in the table.`,
      exportCount: (n: number) => `${n} ${n === 1 ? "URL" : "URLs"} to export`,
      exportDownload: "Download CSV",
      exportReset: "Select all",
      exportClear: "Clear all",
      noCluster: "No cluster",
      findIn: "Find…",
      groupAll: "All",
      groupNone: "None",
      picked: (n: number) => `${n} picked`,
      csvHead: ["Keyword", "URL", "Domain", "GEO", "Search engine", "Latest", "Best", "Average", "Change", "Was", "What changed"],
      changeRow: { up: "up", down: "down", same: "unchanged", new: "new", lost: "dropped out", none: "no comparison" } as Record<string, string>,
      columns: "Columns",
      columnsHint: "Choose which columns the table shows",
      columnsAll: "Show all",
      positionHint: "At the latest check of the keyword in the period. — : not on that page.",
      bestHint: "The best position over the period's checks — and the check compared with, when that is from before the period, so it reads across the same span as the change.",
      averageHint: "The average over the same checks as the best, those it ranked in; the checks it was absent from are not counted as a position.",
      rankedIn: (ranked: number, checks: number) => `ranked in ${ranked} of ${checks} ${checks === 1 ? "check" : "checks"}`,
      trendTitle: (points: string) => `Position by check: ${points}`,
      new: "new",
      lost: (was: number) => `dropped out (was #${was})`,
      was: (was: number) => `was #${was}`,
      shown: (n: number, total: number) => `${n} of ${total} URLs`,
      more: (n: number) => `Show ${n} more`,
      empty: "No URL of the project's ranked in this period.",
      emptyFilter: "No URL matches these filters.",
      ampOf: (site: string) => `AMP of ${site}`,
    },
    fromRuns: (runs: number, rows: number, serps: number) =>
      `${rows} measurement(s) across ${serps} SERP(s), from ${runs} run(s) in this range`,
    colKeyword: "Keyword",
    colOurPositions: "Our positions",
    colShare: "Monopolisation",
    colChecked: "Checked",
    shareWhat:
      "How much of this results page the project's domains occupy between them. 100% would be the whole page.\n\n" +
      "Every slot they hold counts, and each counts for its own weight — so this is not simply the proportion of rows taken, and the list of positions beside it cannot be added up by eye.\n\n" +
      "What a position is worth is set in Settings → SERP Monitor → Visibility weights. If a run captured fewer results than the curve has slots, the same 100% is divided between the slots that were there.",
    shareSlots: (held: number, total: number) => `${held} of ${total} slot(s)`,
    shareHint: (held: number, total: number) =>
      `The project holds ${held} of the ${total} result(s) this run captured. Each of those slots counts for its own weight rather than for one row, which is why this is a percentage and not ${held}/${total}.`,
    slotsHint: (held: number, total: number) =>
      `${held} of the ${total} result(s) this run captured belong to a project domain. This is the raw count behind the percentage above, which weights the same slots by position.`,
    shortPageHint: (total: number) =>
      `⚠ This run captured only ${total} result(s), so the weight of the missing slots is spread over the ones that were there and every figure on this row is measured against a smaller page. A genuinely short SERP and a scrape that came back thin both look like this — the count is what tells them apart.`,
    multiSlot: (n: number) => `${n} slots`,
    multiSlotHint: (positions: string, share: number) =>
      `This domain holds ${positions} on this page — worth ${share}% of it between them. The pill shows its best slot; the others count towards monopolisation too.`,
    serpShare: (share: string) => `Monopolisation ${share}`,
    serpShareHint:
      "Averaged over the keywords on this SERP: on a typical one, this much of the page belongs to the project's domains. Each keyword is its own page, so these are averaged rather than added up. Taken from the most recent run of each keyword inside the range.",
    showRaw: (n: number) => `Show the host each link actually opens (${n} differ)`,
    serpCount: (n: number) => `${n} SERP(s)`,
    substituted: "displayed under a different host",
    substitutedHint: (shown: string, linked: string) =>
      `Displayed as ${shown}, links to ${linked}`,
    unresolvedHint:
      "This job resolves to the displayed site, but the engine reported none for this result — the host below is the raw link.",
    ampOfSite: "AMP domain of",
    ampAvgHint: (site: string, hosts: string) =>
      `Results on the AMP domains of ${site}, as one line: the AMP domain changes daily. In this range they were on: ${hosts}.`,
    ampMore: (n: number) => `+${n} more`,
    ampSince: (day: string) => `since ${day}`,
    ampBefore: (day: string) => `before ${day}`,
    ampConfigHint: (site: string, period: string) =>
      `From the rotator's AMP config: an earlier AMP domain of ${site}, in use ${period} — before SERP Monitor started checking. Its exact dates are not known.`,
    ampPeriodHint: (site: string, period: string) =>
      `The AMP domain of ${site}: ${period}. These are the days the AMP Rotator named it in its answers to SERP Monitor. The rotator says which AMP domain is current, not since when, so it may have been one before the first of them.`,

    notRanking: "not in the captured results",
    ranking: (ranking: number, total: number) =>
      `ranking for ${ranking} of ${total} keyword(s)`,
    footnote: "Each row shows its most recent run inside the range, listing every project domain that ranked, best position first. Monopolisation is how much of that page the project holds between all its domains, weighting each slot by position. A keyword with nothing listed had no project domain among the positions that run captured, which is not the same as not ranking at all. A result on an AMP domain the project's AMP Rotator has named counts as the project's too, and is marked AMP.",

    view: "View",
    viewLatest: "Latest",
    viewLatestHint: "Where each keyword stands now: its most recent run inside the range.",
    viewAverage: "Average",
    viewAverageHint: "Every run in the range, averaged per keyword and domain.",
    avgFootnote: "One row per keyword and domain, over every run of that SERP in the range, sorted by visibility. The average position covers only the runs where the domain was actually present — an absence has no position to average — so presence is reported beside it as its own figure. Visibility combines the two: the share of the page the domain held, averaged over every run including the ones it missed. Best and worst bound the average; a wide spread over few runs is a weak reading, not a position. The AMP domains of one site are a single line, marked AMP: the host changes daily.",
    visibilityWhat:
      "The share of the page this domain held, averaged over every run in the range — including the runs where it did not appear at all, which count as zero.\n\n" +
      "Position and presence in one number: a domain that ranks rarely but high and one that is always there but lower are put on the same scale. Which of them comes out ahead depends on the weights.\n\n" +
      "What a position is worth is set in Settings → SERP Monitor → Visibility weights.",
    visibilityHint: (share: number, ranked: number, runs: number) =>
      `${share}% of this page, averaged over all ${runs} run(s) — the ones it was absent from count as zero. Present on ${ranked} of them. Each slot is worth a share of the page you set in Settings, and a page with fewer results divides the same total between the slots it has.`,
    projectShare: (share: string) => `${share} of this page`,
    projectShareHint:
      "What the project holds on this page between all its domains. Shares are fractions of one page, so they add up — holding every slot would be exactly 100%.",
    colDomain: "Domain",
    colVisibility: "Visibility",
    colAvgPosition: "Avg. position",
    colSpread: "Best – worst",
    colPresent: "Present",
    colAbsent: "Absent",
    colRuns: "Runs",
    fromRunsAvg: (runs: number, rows: number, serps: number) =>
      `${rows} keyword row(s) across ${serps} SERP(s), averaged over ${runs} run(s) in this range`,
    serpRuns: (n: number) => `${n} run(s) in range`,
    presentHint: (ranked: number, runs: number) =>
      `In the results on ${ranked} of ${runs} run(s)`,
    absentHint: (missed: number, runs: number) =>
      `Missing from the captured results on ${missed} of ${runs} run(s)`,
    avgHint: (ranked: number, runs: number) =>
      `Mean of ${ranked} run(s) where it ranked, out of ${runs} that measured it`,
    neverRanked: (runs: number) =>
      `Not in the captured results on any of ${runs} run(s)`,
    substitutedIn: (n: number, runs: number) =>
      `Credited to the host the engine displayed on ${n} of ${runs} run(s)`,
    unknownProvider: "Averaged over runs of unrecorded provenance",
    unknownProviderHint: (n: number, runs: number) =>
      `${n} of the ${runs} run(s) behind this average predate per-run provider recording. Providers number a SERP differently, so this average may blend two scales without being able to say which.`,
    mixedProviders: "Averaged across providers",
    mixedProvidersHint: (providers: string) =>
      `These runs came from ${providers}, which number a SERP differently — DataForSEO counts ads and AI blocks in a position, SerpAPI does not. The average blends the two, so treat it as approximate and compare like with like.`,
    noAverages: "No runs in this range to average. Run one of the project's jobs, or widen the range.",
    noDomains: "This project has no domains yet. Add some by editing the project, and their positions will appear here.",
    noRuns: "No runs in this range. Run one of the project's jobs, or widen the range.",
    geos: "Locations",
    engines: "Search engines",
    noGeo: "no geo",
    scheduled: "Scheduled jobs",
    manualJobs: (n: number) => `${n} more job(s) in this project run only when started by hand.`,
    keywords: "Keywords tracked",
    noKeywords: "No keywords yet — they come from the jobs in this project.",
    exportButton: "Export CSV",
    exportSites: "Sites in the file",
    exportAll: "Whole page",
    exportAllHint: "Every site at every position, ours marked ★: who holds the other spots too.",
    exportOurs: "Only ours",
    exportOursHint: "Only the project's own sites, as in the tables.",
    exportGrid: "CSV · grid",
    exportGridHint:
      "One row per query; columns 1, 2, 3… hold the site at that position. The easiest to read. " +
      "Same rows as on screen: the latest run of each query in the period.",
    exportList: "CSV · list",
    exportListHint:
      "One row per position: query, position, site, ours or not, URL, title. For filters and pivot tables. " +
      "Same rows as on screen: the latest run of each query in the period.",
  },
  jobForm: {
    mode: "Mode",
    modeSerp: "1 · SERP monitoring",
    modeSerpHelp: "Scrape SERPs and review domain / URL distribution.",
    modeAnalyzer: "2 · SERP analyzer",
    modeAnalyzerHelp:
      "Scrape SERPs, then pull Ahrefs metrics for every result URL and show ranking difficulty per keyword.",
    modeCompare: "3 · Compare SERP APIs",
    modeCompareHelp:
      "Send the same queries through several providers and compare domains, URLs and result counts side by side.",
    compareProviders: "Providers to compare",
    compareProvidersHelp:
      "Every query goes to every selected provider, and each provider bills for its own requests — the estimate below adds them up.",
    compareNeedTwo: "Pick at least two providers to compare.",
    compareYandexGap: (names: string) =>
      `${names} cannot run Yandex. Those cells will read “not supported” — they are never sent and never billed, and they do not count as differences.`,
    estimateByProvider: "Per provider",
    ahrefsMetrics: "Ahrefs metrics",
    ahrefsMetricsHelp:
      "Which metrics to pull for each result URL. Analysed in exact-URL mode, so UR is per page rather than per domain.",
    whois: "Domain age (WHOIS)",
    whoisHelp:
      "Look up when each domain was registered and give the age to the AI. A site with hundreds of referring domains and no top-10 keywords reads very differently at six months old than at ten years.",
    whoisCost:
      "Asked of RDAP first, which is free; DataForSEO WHOIS only for the domains RDAP cannot answer (mostly country zones such as .kz, .ru, .by, .uz). DataForSEO bills per request (~$0.12), not per domain. Answers are cached for 180 days, \u201cnot found\u201d for 14.",
    whoisNoCreds:
      "⚠ DataForSEO credentials are not set — domains RDAP cannot answer (mostly country zones) will have no age. The rest of the run is unaffected. Add them in Settings → SERP Monitor → DataForSEO.",
    ahrefsCacheTitle: "Metric cache",
    ahrefsCacheHelp:
      "How long a fetched Ahrefs metric is reused across runs instead of being bought again. Unlike a domain's registration date, DR and backlink counts move — too long a TTL means a monitoring run reports figures it never re-measured. 0 turns the cache off.",
    ahrefsCacheTtl: "Reuse metrics for",
    ahrefsCacheDays: "days",
    ahrefsCacheOff: "Cache disabled — every run buys every metric again.",
    ahrefsCacheClear: "Clear cache",
    ahrefsCacheCleared: (n: number) => `Cleared ${n} cached metric(s).`,
    ahrefsNoKey:
      "⚠ No Ahrefs API key configured — analyzer runs will fail. Add one in Settings → SERP Analyzer → Ahrefs.",
    ahrefsUnitsEstimate: (urls: number, perUrl: number, units: number) =>
      `≈ ${urls.toLocaleString()} URLs × ${perUrl} units each ≈ ${units.toLocaleString()} Ahrefs units per run. Upper bound — duplicate URLs are fetched once and cached lookups bill less.`,
    ahrefsDomainMetrics: "Domain-level metrics",
    ahrefsDomainMetricsHelp:
      "Fetched separately, in domain mode. This is what tells a weak page on a STRONG site apart from a weak page on a weak site — page metrics alone cannot. Domains dedupe far harder than URLs, so this costs much less than the URL pass.",
    ahrefsDomainOff: "None selected — domain enrichment is off for this job.",
    ahrefsDomainUnits: (perDomain: number, units: number, combined: number) =>
      `Plus domains at ${perDomain} units each ≈ ${units.toLocaleString()} units — about ${combined.toLocaleString()} in total.`,
    ahrefsUnderFloor: (base: number) =>
      `Every request costs at least ${base} units, and this run is under that floor — additional metrics here are effectively free.`,
    name: "Name",
    namePlaceholder: "e.g. Brand monitoring — KZ/RU",
    keywords: "Keywords",
    preferShownHost: "Resolve AMP and CDN results to the site shown",
    preferShownHostHelp:
      "An AMP or CDN result links to a delivery host while the engine prints the publisher — by.tribuna.com displayed over a cloudfront.net link. With this on, the displayed site is what counts as ranking. Raw hosts are always stored and stay one click away.",
    preferShownHostWarn:
      "This is the same field a doorway spoofs: a result printing someone else's brand will be reported under that brand. Substituted results are marked ⇄ so you can see which ones moved.",
    project: "Project",
    noProject: "— no project —",
    projectHint: "Jobs with a project are grouped under its folder in the jobs list.",
    projectNoneYet: "No projects yet — create one on the Projects page to group jobs.",
    keywordsHint: "(one per line, max 1000)",
    keywordsOverflow: (dropped: number, max: number) =>
      `${dropped} line(s) beyond the ${max}-keyword limit will not be saved — trim the list before saving.`,
    keywordsPlaceholder: "acme login\nacme review\nacme скачать",
    keywordsCount: (n: number) => `${n} keyword(s)`,
    provider: "Provider",
    providerHelpPrefix: "Configure provider credentials in ",
    providerHelpLink: "Settings",
    providerHelpSuffix:
      " first. Each provider differs slightly: each has its own location list, and with a provider selected the job form's picker searches that provider's complete list — SerpAPI: its own; DataForSEO: its own (asked by the location's ID); Bright Data & Oxylabs: Google's geo-targets list. The same city can be named differently in each, so a location is matched across them by Google's ID, not by name. For Yandex, Bright Data & Oxylabs only honor country / yandex_lr.",
    dataforseoNeedsLanguage:
      "⚠ DataForSEO needs a language for every query — unlike Google, it has no default and refuses the request without one. Pick a language (for Kazakhstan, usually ru), or its queries will fail.",
    dataforseoNoYandex:
      "⚠ DataForSEO has no Yandex endpoint — their SERP API covers Google, Bing, Yahoo, Baidu, Naver and Seznam only. Yandex searches in this job will fail. Use SerpAPI, Bright Data or Oxylabs for Yandex, or remove Yandex from Engines and keep DataForSEO for Google.",
    engines: "Engines",
    enginesPlaceholder: "Pick engines…",
    devices: "Devices",
    devicesPlaceholder: "Pick devices…",
    locations: "Locations (countries / regions / cities)",
    locationsPlaceholder: "Pick from saved or search…",
    locationsOnly: (providers: string) =>
      `Only locations ${providers} can search are listed. Each provider keeps its own location list, and the same city can be named differently in each.`,
    locationUnsupported: (loc: string, providers: string) =>
      `${providers} cannot search “${loc}”: it is not in that provider's location list. Remove it and pick the place again from the list.`,
    locationCountryOnly: (loc: string, providers: string) =>
      `“${loc}” is not in Google's location list, which is the list ${providers} goes by: Google will ignore it and the search will cover the whole country. Pick the place again from the list for city-level results.`,
    languages: "Languages",
    languagesPlaceholder: "Pick languages…",
    googleDomains: "Google domains (optional)",
    googleDomainsPlaceholder: "Defaults from country if empty",
    topN: "Top N positions",
    schedule: "Schedule",
    cronHelpPrefix: (tz: string) => (
      <>
        Cron expression in <strong>{tz}</strong>. E.g. <code>0 */6 * * *</code> = every 6 hours.
      </>
    ),
    cronEditHint: (
      <>
        {" "}To change it, edit <code>scheduler.py</code> and rebuild the api (<code>docker compose up -d --build api</code>).
      </>
    ),
    enabled: "Enabled",
    cronPlaceholder: "0 */6 * * *",
    cronPresets: {
      hourly: "Hourly",
      every6h: "Every 6h",
      daily06: "Daily 06:00",
      daily09And21: "Daily 09:00 + 21:00",
      weekdays08: "Weekdays 08:00",
    },
    estimateTitle: "Estimated calls per run",
    estimateBreakdown: (g: number, y: number) => `Google: ${g} · Yandex: ${y}`,
    estimateApprox: "(Approximate — backend dedupes identical variants.)",
    estimateCostTitle: "Estimated cost per run",
    estimateRate: (rate: string) => `at ${rate}/search`,
    estimateEditRate: "edit rate",
    estimateDepthNote: (provider: string, units: number, topN: number) =>
      provider === "brightdata"
        ? `⚠ Bright Data returns one Google page (~10 results) per request — Top N ${topN} takes up to ${units} requests per Google search (${units}× the price). Lower Top N to 10 to pay the base rate.`
        : `⚠ DataForSEO bills per 10 results — Top N ${topN} counts as ${units} SERPs per search (${units}× the price). Lower Top N to 10 to pay the base rate.`,
    saveCreate: "Create job",
    saveChanges: "Save changes",
    saveAndRunCreate: "Create & run now",
    saveAndRunUpdate: "Save & run now",
    engineOptions: { google: "Google", yandex: "Yandex" },
    deviceOptions: { desktop: "Desktop", mobile: "Mobile" },
    targeting: {
      noLocations:
        "No locations chosen — queries will run with no geo targeting (or country-default if a Google domain is set).",
      header: (provider: string) => (
        <>
          Effective targeting · provider:{" "}
          <span className="text-neutral-800 dark:text-neutral-200">{provider}</span>
        </>
      ),
      noEngines: "No engines selected.",
      noLrWarning: (
        <>
          ⚠ No <code>yandex_lr</code> saved for this location — Yandex falls back
          to country domain only. Add a Yandex region ID in Settings → this location.
        </>
      ),
      gran: { city: "city", country: "country", none: "no geo" },
      engineGoogle: "Google",
      engineYandex: "Yandex",
    },
  },
  run: {
    title: (id: number) => `Run #${id}`,
    headerStats: (done: number, total: number) =>
      `${done}/${total} queries`,
    failed: (n: number) => `${n} failed`,
    exportTop: "Export top",
    downloadCsv: "Download CSV",
    filterPlaceholder: "Filter by keyword…",
    missingQueries: (missing: number, total: number) =>
      `${missing} of ${total} queries returned nothing.`,
    missingHint:
      "Those keywords have no SERP, and so no metrics, no domain age and no AI verdict. Retrying re-issues only the missing queries — the rest of the run is not re-scraped or re-billed.",
    retryQueries: (n: number) => `Retry ${n}`,
    retrying: "Retrying…",
    phases: {
      scrape: "SERP scrape",
      ahrefs: "Ahrefs metrics",
      whois: "Domain age",
      ai: "AI verdicts",
    } as Record<string, string>,
    phaseFailed: (n: number) => `${n} failed`,
    phaseHint:
      "Ahrefs and the domain-age lookups write nothing to the table until they finish, so the table can sit still for minutes on a healthy run. Verdicts then arrive one keyword at a time.",
    stoppedDuring: (phase: string) => `Stopped during: ${phase}`,
    verify: {
      title: "Verify scraped queries",
      summary: (n: number) =>
        `(${n} unique request${n === 1 ? "" : "s"} — click any URL to see exactly what Google / Yandex would show)`,
      footer: (
        <>
          These are the human-readable URLs the search engines themselves accept —
          provider-specific params (<code>brd_json</code>, <code>parse</code>,{" "}
          <code>source</code>, etc.) are stripped so what you see in the browser is
          what we asked Google/Yandex for.{" "}
          <strong>Mobile variants</strong> look identical to desktop in the URL for
          both engines — mobile SERPs are User-Agent driven. Use Chrome dev-tools
          (Ctrl+Shift+M) to switch User-Agent if you need to verify a mobile scrape
          against the live SERP.
        </>
      ),
    },
    groupCount: (results: number, variants: number) =>
      `${results} result(s) · ${variants} variant(s)`,
    streaming: "Results are streaming in…",
    noResults: "No results.",
    overview: {
      title: "Overview",
      hint: "Domain & URL distribution across all searches in this run.",
      engineGoogle: "Google",
      engineYandex: "Yandex",
      engineSummary: (n: number) => `${n} result row(s)`,
      domainsTitle: "Domains",
      urlsTitle: "URLs",
      colDomain: "Domain",
      colUrl: "URL",
      colCount: "Count",
      colAvgPos: "Avg. pos.",
      noneForEngine: "No rows for this engine.",
      fullBreakdown: "Full breakdown →",
    },
  },
  overviewPage: {
    title: (id: number) => `Overview — Run #${id}`,
    back: "← Back to run",
    groupBy: "Group by",
    dimEngine: "Engine",
    dimGeo: "GEO",
    dimLanguage: "Language",
    dimDevice: "Device",
    combinations: (n: number) => `${n} combination(s)`,
    allResults: "All results",
    rowsInGroup: (n: number) => `${n} row(s)`,
    empty: "No results in this run yet.",
  },
  variantLabel: {
    google: "Google",
    yandex: "Yandex",
    desktop: "Desktop",
    mobile: "Mobile",
    country: "country",
    noGeo: "no geo",
  },
  clusters: {
    title: "Clusters",
    help: "Every cluster of the project's keywords, and every keyword with its cluster. Rename a cluster or take it off its keywords, change one keyword's cluster, or set many from a list. Nothing changes until \u201cSave\u201d. Keywords themselves are added and removed on the project page.",
    open: "Clusters",
    clustersTitle: "Clusters",
    noClusters: "The project has no clusters yet: give keywords one below, or add them with a cluster on the project page.",
    cluster: "Cluster",
    keywords: "Keywords",
    keyword: "Keyword",
    none: "No cluster",
    show: "Show",
    showHint: (name: string) => `Show the keywords of “${name}”`,
    rename: "Rename",
    cancel: "Cancel",
    remove: "Remove",
    removeConfirm: (name: string, n: number) => `Take the cluster \u201c${name}\u201d off its ${n} ${n === 1 ? "keyword" : "keywords"}? The keywords stay.`,
    keywordsTitle: "Keywords",
    search: "Find a keyword or cluster\u2026",
    allClusters: "All clusters",
    findCluster: "Find a cluster\u2026",
    bulk: "Set from a list",
    bulkHint: "One per line: a keyword of the project and its cluster after a Tab, \u201c;\u201d or \u201c,\u201d. An empty cluster takes one away. Keywords the project does not have are skipped.",
    bulkPlaceholder: "casino online, Brand\nslots; Games",
    bulkApply: "Apply",
    bulkDone: (set: number, unknown: number) =>
      `Set: ${set}.` + (unknown ? ` Not in the project, skipped: ${unknown} \u2014 add them on the project page first.` : "") + " Press \u201cSave\u201d to keep it.",
    changes: (n: number) => `${n} ${n === 1 ? "change" : "changes"} to save`,
    undo: "Undo changes",
    noKeywords: "The project has no keywords yet.",
    nothingFound: "Nothing matches.",
    shown: (n: number, total: number) => `${n} of ${total}`,
    more: "Show more",
  },
  projectKeywords: {
    placeholder: "Find or add a keyword…",
    add: "Add",
    clearAll: "Clear all",
    removeOne: (k: string) => `Remove \u201c${k}\u201d`,
    pending: (removed: number, added: number, clusters: number) =>
      `To remove: ${removed} \u00b7 to add: ${added}` + (clusters ? ` \u00b7 clusters to set: ${clusters}` : ""),
    bulk: "Add a list",
    bulkHint: "One keyword per line. A cluster may follow after a Tab, \u201c;\u201d or \u201c,\u201d \u2014 \u201ckeyword, cluster\u201d. A keyword the project has already only gets its cluster.",
    bulkPlaceholder: "casino online\nslots, Games\nbonus; Promo",
    bulkAdd: "Add these",
    csvUpload: "Upload CSV",
    csvHint: "CSV: the keyword in the first column, the cluster in the second \u2014 or wherever a header row (Keyword, Cluster) puts them.",
    staged: (keywords: number, clusters: number) =>
      `Ready to save: ${keywords} new ${keywords === 1 ? "keyword" : "keywords"}, ${clusters} ${clusters === 1 ? "cluster" : "clusters"} \u2014 press \u201cSave\u201d below to keep them.`,
    nothingRead: "No keyword was read from that.",
    undo: "Undo",
    empty: "No keywords.",
    nothingFound: "No keyword matches. Press Enter to add it.",
    confirm: (n: number) => `Remove ${n} keyword(s) from the project? Its jobs will stop checking them.`,
  },
  serpCsv: {
    button: "Upload CSV",
    title: "Upload a SERP from a CSV",
    help:
      "A file from the internal SERP-checking tool. Four columns are read — Keywords, GEO, Domain / URL, Position — and every other column is ignored. The upload is stored as a run of this project: its positions, blocks and Proxy Checker sending treat it like any other run.",
    file: "File",
    engine: "Search engine",
    device: "Device",
    day: "Day of the check",
    fieldsHint:
      "The file does not say which search engine or device it was checked on, so choose them here. The day is read off the file name when it has one.",
    upload: "Upload",
    uploading: "Uploading…",
    showPositions: "Show positions",
    barTitle: (rows: number, queries: number) =>
      `Uploaded ${rows} ${rows === 1 ? "position" : "positions"} for ${queries} ${queries === 1 ? "query" : "queries"}`,
    barDay: (day: string) => `checked on ${day}`,
    barEmpty: (n: number) => `${n} empty (\u201c\u2013\u201d) skipped`,
    barGeosAdded: (list: string) => `added to the project's GEOs: ${list}`,
    barProxyChecker: "being sent to the Proxy Checker",
    barNotLoaded: (n: number) => `${n} ${n === 1 ? "row" : "rows"} not loaded`,
    barRun: (id: number) => `Run #${id}`,
    dismiss: "Hide",
    log: {
      title: "CSV uploads",
      help: "Every SERP export uploaded to this project, newest first. Deleting an upload removes its positions from the Positions and Blocks tabs; keywords and GEOs it added to the project stay.",
      empty: "Nothing has been uploaded yet. Use \u201cUpload CSV\u201d at the top of the page.",
      col: {
        uploaded: "Uploaded", file: "File", day: "Checked on", serp: "Engine \u00b7 device", rows: "Positions / queries",
        geos: "Countries", skipped: "Skipped", actions: "Actions",
      },
      rowsQueries: (rows: number, queries: number) => `${rows} / ${queries}`,
      geosAdded: (list: string) => `added to GEOs: ${list}`,
      empty_: (n: number) => `${n} empty (\u201c\u2013\u201d)`,
      notLoaded: (n: number) => `${n} ${n === 1 ? "row" : "rows"} not loaded`,
      bad: (n: number) => `${n} unreadable`,
      none: "none",
      notKept: "Not recorded for uploads made before 14.10.2026",
      notSent: "not sent",
      accepted: (ok: number, all: number) => `accepted ${ok} of ${all}`,
      noAnswer: (n: number) => `no answer: ${n}`,
      refused: (n: number) => `refused: ${n}`,
      runName: (id: number) => `Run #${id}`,
      delete: "Delete",
      deleting: "Deleting\u2026",
      deleteConfirm: (what: string, day: string, rows: number) =>
        `Delete the upload \u201c${what}\u201d for ${day} and its ${rows} positions? Keywords and GEOs it added stay in the project.`,
    },
    failTitle: "The file was not uploaded",
    skippedEmpty: (n: number) => `${n} ${n === 1 ? "position" : "positions"} listed with nothing on ${n === 1 ? "it" : "them"} (“–”): skipped.`,
    skippedGeo: (list: string) => `Rows left out because the country was not recognised: ${list}.`,
    skippedBad: (n: number) => `${n} ${n === 1 ? "row" : "rows"} could not be read.`,
    line: "line",
  },
  tools: {
    proxyChecker: {
      title: "Proxy Checker",
      help:
        "Gets your projects' own domains that the SERP checks found, one request per country, so it can check them from that country. Only the connection is set here: WHEN a project sends, what it would send and what it has sent are on that project's own page, on its Blocks tab.",
      url: "API address",
      urlPlaceholder: "https://\u2026/api/daily-check",
      token: "Token",
      tokenPlaceholder: "Bearer token",
      wait: "Wait for the answer",
      waitUnit: "minutes",
      waitHint: (lo: number, hi: number) =>
        `The Proxy Checker checks the domains through its proxies before it answers, so a request with more domains takes longer. With no answer in this time, the send is logged as \u201cno answer\u201d. From ${lo} to ${hi} minutes. \u201cSend now\u201d on a project page waits as long for each country.`,
      waitBad: (lo: number, hi: number) => `The wait must be a whole number of minutes from ${lo} to ${hi}.`,
      connected: "connected",
      notConnected: "not connected",
      noTest:
        "There is no separate \u201ctest\u201d: the API has only the one request, so the token is proved by the first real send \u2014 open a project's Blocks tab, press \u201cSend now\u201d and look at the answer there.",
      projectsTitle: "When each project sends",
      projectsHelp: "Set on the project's own page.",
      projectsEmpty: "No projects yet.",
      mode: {
        off: "Off",
        after_run: "After every run / CSV upload",
        daily: (time: string) => `Daily at ${time}`,
      },
      auto: "Send automatically after every SERP check and CSV upload",
      autoHint:
        "When on, a project's domains go to the Proxy Checker right after every SERP check or CSV upload. This applies to every project except those with their own choice on the project page.",
      logTitle: "Recent sends",
      logEmpty: "Nothing has been sent yet.",
      col: { when: "Sent", project: "Project", geo: "Country", domains: "Domains", trigger: "Why", result: "Answer" },
      trigger: {
        after_run: "after a run / upload", daily: "daily", manual: "by hand",
        direct: "on the timer, without a SERP", direct_manual: "by hand, without a SERP",
      } as Record<string, string>,
      accepted: "accepted",
      sendingNow: (trigger: string, geos: string, done: number, requests: number, when: string) =>
        `Sending to the Proxy Checker now (${trigger}; ${geos}): ${done} of ${requests} ${requests === 1 ? "request" : "requests"} done \u00b7 started ${when}. It goes on even if this page is closed or refreshed; each answer is saved as soon as it arrives.`,
      took: (seconds: number) => `${seconds} s`,
      tookHint: "How long the request took. The Proxy Checker is behind Cloudflare, which gives up after 120 s with HTTP 524 \u2014 hence at most 3 domains per request.",
      sendingBusy: "Wait for the send that is running to finish.",
      sendingDone: "The send has finished.",
      refused: (code: number | null) => (code ? `refused \u00b7 HTTP ${code}` : "no answer"),
      exchange: {
        show: "curl and raw answer",
        hide: "hide curl and answer",
        justSent: "Just sent",
        request: "Request (curl)",
        tokenHidden:
          "The request as it was sent, on one line. The token is not kept in the log: put yours in place of <token> to run it. Runs as is in bash and in the Windows command prompt (cmd).",
        response: "Raw answer from the Proxy Checker",
        noResponse: "No HTTP answer: the connection itself failed",
        notKept:
          "This send was made before requests and raw answers were kept. Only the start of the answer was stored:",
        copied: "Copied",
      },
    },
    blocks: {
      title: "Domains in the SERPs, by proxy",
      demoBadge: "demo data",
      help:
        "This project's domains that are in the SERPs, country by country, and the status each of that country's proxies gave them in the Proxy Checker in the chosen period. Domains with a proxy that did not say PASS come first, the best-ranking of them on top.",
      periodHint:
        "The period is about when the proxies answered: each domain shows their latest answer inside it. Which domains are in the SERPs is read from the period and the week before it.",
      demoTitle: "Demo data",
      demoText:
        "No proxy has reported on these domains yet, so the proxies and their statuses below are made up to show what the table will look like. The domains, countries and positions are real.",
      demoOff: "Remove the example",
      noReports:
        "Nothing has been checked for this period: no proxy has reported on any of these domains yet.",
      demoOn: "Show an example on demo data",
      all: "All",
      allGeos: "All GEOs",
      filterLabel: "Which domains",
      filter: { not_pass: "Not PASS", pass: "All PASS", unchecked: "Not checked" },
      filterHint: {
        not_pass: "Domains with at least one proxy whose status is not PASS.",
        pass: "Domains every proxy gave PASS.",
        unchecked: "Domains no proxy has reported on.",
      },
      domains: (n: number) => `${n} ${n === 1 ? "domain" : "domains"} in the SERPs`,
      proxies: (n: number) => `${n} ${n === 1 ? "proxy" : "proxies"}`,
      noProxies: "no proxy has reported for this country yet",
      col: {
        domain: "Domain", ampDomain: "AMP domain", keywords: "Keywords", best: "Best position", seen: "Last in SERPs",
        failing: "Not PASS", checked: "Checked",
      },
      helpAmp:
        "Under each country's table is a second one for AMP domains: the ones that country's SERPs show themselves, and today's AMP domain of every domain found there — the host a visitor from the SERP lands on.",
      ampOf: (main: string) => `AMP of ${main}`,
      ampInSerps: "in the SERPs itself",
      viaMain: "its main domain's position",
      ampDomains: (n: number) => `${n} AMP ${n === 1 ? "domain" : "domains"}`,
      failingTitle: "Not passing in Blocks",
      failingSome: (n: number) => `${n} not passing`,
      failingNonePill: "all pass",
      failingNoChecksPill: "no checks",
      failingPeriod: "Period",
      failingHelp:
        "Domains in the SERPs in this period where at least one proxy did not say PASS — by each domain's latest check inside the period.",
      failingNone: "Every domain checked in this period passes.",
      failingNoChecks: "Nothing was checked in this period.",
      failingUnchecked: (n: number) => `Not checked in this period: ${n}.`,
      failingLink: "All statuses are on the Blocks tab",
      failingMain: (n: number) => `Main domains: ${n}`,
      failingAmp: (n: number) => `AMP domains: ${n}`,
      failingNoneOfKind: "None.",
      keywordsHint: "Distinct keywords this domain ranks for in this country, in each query's latest check.",
      checked: (when: string) => `checked ${when}`,
      direct: "without a SERP",
      unchecked: "not checked",
      reason: {
        geoOff: "this GEO is switched off for sending",
        neverSent: "not sent to the Proxy Checker yet",
        refused: (when: string, code: number | null) =>
          (code ? `sent ${when}, refused · HTTP ${code}` : `sent ${when}, no answer`),
        notRead: (when: string) => `sent ${when}, the answer says nothing about it`,
      },
      empty: "For this period there are no domains of this project in the SERPs and no answers from the proxies.",
      emptyFilter: "No domains match the filter.",
    },
    geos: {
      title: "Project GEOs",
      notSaved: "not saved yet",
      help:
        "Every country this project works in. Set it here once: the connected tools choose among these GEOs \u2014 the Proxy Checker card on the Blocks tab picks whose SERP findings it is sent.",
      label: "Countries",
      placeholder: "Add a country\u2026",
      fromJobs: "Nothing is saved yet: these are the countries the project's jobs check today. Adjust the list and save it.",
      noJob: (codes: string) =>
        `No job of this project checks ${codes} yet, so there are no SERP findings for it to send. Add a job with a location there, or remove it from the list.`,
    },
    ampRotator: {
      title: "AMP Rotator",
      connected: (n: number) => `${n} ${n === 1 ? "endpoint" : "endpoints"}`,
      notConnected: "not connected",
      help:
        "Tells SERP Monitor today's AMP domain of each of a project's domains. Save the login and password once — all rotators share them — then add the rotator each project uses: choose the project, give the rotator's address and the time of day to ask it. SERP Monitor sends that rotator all of the project's domains and keeps the AMP domain it names for each; a domain the rotator does not serve is skipped. A project can have more than one rotator.",
      access: "Login and password — one for all rotators",
      accessHint:
        "Every endpoint below is asked with this login and password (HTTP Basic). The password is saved and never shown again.",
      accessNeeded: "Save the login and password first: without them no rotator can be asked.",
      accessClearConfirm: "Forget the login and password? The endpoints stay, but nothing will be fetched until a pair is saved again.",
      login: "Login",
      col: {
        project: "Project", endpoint: "Endpoint", time: "Asked daily at", last: "Last fetch",
        domain: "Domain", amp: "AMP domain today", since: "Active since", rotator: "Rotator",
      },
      password: "Password",
      passwordKeep: "leave empty to keep the saved one",
      passwordSaved: "a password is saved",
      passwordMissing: "no password is saved yet",
      time: "Request time, every day (your clock)",
      timeHint:
        "Rotators switch once a day: set a time after this rotator has switched. If SERP Monitor is not running then, it asks when it starts.",
      formAdd: "Add an endpoint",
      formEdit: "Edit the endpoint",
      chooseProject: "Choose a project…",
      noProjects: "There are no projects yet: create one first.",
      formHint:
        "Every endpoint has its own request time; the login and password above are shared. There is no separate test: press “Fetch now” after adding and look at the result in the row.",
      added: "Added. Press “Fetch now” to try it.",
      config: {
        button: "AMP config",
        hint: "Upload this rotator's AMP config (JSON) to learn the site's earlier AMP domains.",
        help: "\u201cAMP config\u201d: upload a rotator's config file (JSON — a list of sites with their \u201camps\u201d). For each site of the project, the AMP domains listed before the one the daily check saw last are its earlier AMP domains, from before SERP Monitor was checking: they count as the project's on the Positions tab and go to the Proxy Checker when a SERP shows them. The ones after it in the list are not used yet and are left out. Uploading again adds what is new.",
        last: (when: string, added: number) => `AMP config ${when} \u00b7 earlier AMP domains: ${added}`,
        resultTitle: (project: string, added: number, sites: number) =>
          `AMP config of ${project}: ${added} earlier AMP ${added === 1 ? "domain" : "domains"} added, ${sites} ${sites === 1 ? "site" : "sites"} in the file`,
        known: (n: number) => `Already known: ${n}.`,
        siteOk: (n: number, current: string) => `${n} earlier AMP ${n === 1 ? "domain" : "domains"} (listed before ${current}, the one the daily check saw last)`,
        siteNotInProject: "not among the project's domains — left out",
        siteNeverChecked: "the daily check has not seen its AMP domain yet, so which ones came before is not known — left out",
        siteCurrentNotListed: (current: string) => `its current AMP domain ${current} is not in the list, so which ones came before is not known — left out`,
      },
      deleteConfirm: (project: string) => `Remove this endpoint of ${project}, and the AMP domains fetched from it?`,
      fetchNow: "Fetch now",
      fetching: "Fetching…",
      neverFetched: "not fetched yet",
      fetchedOk: (amp: number, sent: number) => `${amp} AMP ${amp === 1 ? "domain" : "domains"} for ${sent} sent`,
      fetchFailed: (code: number | null) => (code ? `failed · HTTP ${code}` : "no answer"),
      nextRun: (when: string) => `next: ${when}`,
      projectTitle: "AMP domains today",
      projectHelp: "Today's AMP domain of each of this project's domains, as its AMP Rotator last answered. Results on these domains, and on the ones named on earlier days, count as the project's on the Positions tab.",
      settingsLink: "Endpoints are set in Settings → Tools Connection",
      fetchedAt: (when: string) => `fetched ${when}`,
      projectFailed: (url: string, when: string) =>
        `The last fetch from ${url} failed (${when}), so what is shown from it is the answer before that.`,
      projectNever: "Nothing has been fetched yet. Press “Fetch now”.",
      projectEmpty: "The rotator answered, but named no AMP domain for any of this project's domains.",
    },
    direct: {
      title: "Check without SERPs",
      help:
        "Sends the domains you choose to the Proxy Checker, whether or not any SERP was checked \u2014 on a timer, or once with \u201cCheck now\u201d. One request per chosen GEO; each domain\u2019s AMP domain of the day goes with it. The answers appear in the table above.",
      toggle: "Check on a timer",
      off: "off",
      howOften: "How often",
      every: (h: number) =>
        h === 1 ? "every hour" : h < 24 ? `every ${h} hours` : h === 24 ? "every day" : h === 168 ? "every week" : `every ${h / 24} days`,
      domains: "Domains",
      allDomains: "All domains, including ones added to the project later",
      allHint: "Untick \u201cAll domains\u201d to choose them one by one.",
      domainsHint: "Click a domain to switch it off or on.",
      noneChosen: "No domain is chosen \u2014 nothing will be checked.",
      noDomains: "The project has no domains yet: add them when editing the project.",
      ampTitle: (hosts: string) => `Its AMP domain of the day goes too: ${hosts}`,
      allGeos: "All the project\u2019s GEOs, including ones added later",
      allGeosHint: "Untick \u201cAll the project\u2019s GEOs\u201d to choose them one by one.",
      geosHint: "Click a GEO to switch it off or on.",
      noGeoChosen: "No GEO is chosen \u2014 nothing will be checked.",
      geosFromProject: "The project\u2019s GEOs come from the \u201cProject GEOs\u201d card on the Overview.",
      geosFromJobs:
        "The project\u2019s GEOs are not set, so the countries its jobs check stand in. Set them in the \u201cProject GEOs\u201d card on the Overview.",
      geosNone: "The project has no GEOs: add them in the \u201cProject GEOs\u201d card on the Overview. Without one there is nothing to check.",
      onHint: (every: string) => `The chosen domains go to the Proxy Checker ${every}, counted from when this was saved.`,
      offHint: "Off: nothing is checked on a timer.",
      nextRun: (when: string) => `Next check: ${when}.`,
      lastAt: (when: string) => `Last check: ${when}.`,
      checkNow: "Check now",
      checking: "Checking\u2026",
      checkNowHint: "Sends the domains and GEOs picked above once, right away \u2014 the timer can be off and the choice unsaved.",
      resultMore: "The requests and answers are in \u201cRecent sends\u201d of the Proxy Checker card below.",
    },
    project: {
      title: "Proxy Checker",
      help:
        "Sends this project's own domains that the checks found in the SERPs to the Proxy Checker \u2014 one request per country, only the domains actually found there.",
      notConnected: "The Proxy Checker is not connected yet, so nothing will be sent.",
      connectLink: "Connect it in Settings \u2192 Tools Connection",
      when: "When to send",
      modeDaily: "Once a day",
      modeInherit: "As in Settings",
      modeInheritOn:
        "As set in Settings \u2192 Tools Connection, which right now is: right after each of this project's checks finishes, or a CSV is uploaded \u2014 the domains found in it.",
      modeInheritOff:
        "As set in Settings \u2192 Tools Connection, where automatic sending is off right now: nothing is sent on its own. \u201cSend now\u201d below still works.",
      bySettings: "as in Settings",
      settingsLink: "Change it there",
      modeOffHint: "Nothing is sent automatically. \u201cSend now\u201d below still works.",
      modeAfterRunHint: "Right after each of this project's checks finishes, or a CSV is uploaded: the domains found in it.",
      modeDailyHint: (hours: number) => `Once a day at the time you set: every domain found in the last ${hours} hours.`,
      time: "at (your clock)",
      nextRun: (when: string) => `Next send: ${when}.`,
      previewTitle: (hours: number) => `Would be sent now \u2014 checked or uploaded in the last ${hours} hours`,
      previewEmpty: (hours: number) =>
        `No check ran and no CSV was uploaded in the last ${hours} hours with a domain of this project in it, so there is nothing to send.`,
      previewAmpNote:
        "Domains marked AMP are AMP domains from the project's AMP Rotator. One is sent for a country when a SERP there showed it; and today's AMP domain of every found domain is sent along with that domain.",
      sendNow: "Send now",
      sending: "Sending\u2026",
      sendNowHint: (hours: number) => `Sends what the checks and uploaded CSVs of the last ${hours} hours found, whatever the schedule.`,
      sentResult: (ok: number, total: number) => `Sent: ${ok} of ${total} accepted.`,
      nothingToSend: "Nothing to send.",
      countries: (n: number) => `${n} ${n === 1 ? "country" : "countries"}`,
      geos: "GEOs to send",
      geosHint:
        "Click a country to switch it off or on. Only the switched-on GEOs' SERP findings are sent; the number is how many of this project's domains were found there in the checks and uploaded CSVs of the last 24 hours. While all are on, a GEO added to the project later is sent too.",
      geosEmpty: "No GEO is switched on, so nothing will be sent.",
      geosNone: "The project has no GEOs yet: add them in the \u201cProject GEOs\u201d card on the Overview tab.",
      geoFound: (n: number, hours: number) => `${n} of this project's domains found in the last ${hours} hours`,
      saveFirst: "Save the changes first.",
    },
  },
  settings: {
    title: "Settings",
    intro: "Grouped by the part of the app they configure.",
    tabs: {
      monitor: {
        label: "SERP Monitor",
        intro: "SERP API credentials, the price of a query, what a position is worth, and saved locations.",
      },
      analyzer: {
        label: "SERP Analyzer",
        intro: "Ahrefs, AI providers, the SERP-difficulty prompt and the opportunity formula.",
      },
      tools: {
        label: "Tools Connection",
        intro: "Other tools SERP Monitor hands its findings to.",
      },
    },
    addLocation: {
      title: "Add a location",
      help: (
        <>
          <code>canonical_name</code> uses SerpAPI&rsquo;s comma-separated format.{" "}
          <code>yandex_lr</code> is Yandex&rsquo;s numeric region ID — required for
          city-level Yandex targeting (e.g. Moscow=213, Almaty=162, Tashkent=10335).
        </>
      ),
      phCanonical: "canonical_name",
      phName: "display name",
      phCc: "cc (kz, uz…)",
      phType: "type…",
      phYandexLr: "yandex_lr",
      typeOptions: {
        Country: "Country",
        Region: "Region",
        City: "City",
        Other: "Other",
      },
    },
    bulk: {
      title: "Bulk import",
      help: (
        <>
          One per line. Tab- or pipe-separated columns:
          <code> canonical_name | name | country_code | target_type | yandex_lr</code>.
          Only the first column is required. Duplicates skipped silently.
        </>
      ),
      result: (added: number, skipped: number) =>
        `Added ${added}, skipped ${skipped} (duplicates)`,
    },
    list: {
      title: "Saved locations",
      perProviderHelp: (
        <>
          What gets sent per provider, derived from each row:{" "}
          <span className="text-neutral-700 dark:text-neutral-200 font-medium">
            SerpAPI
          </span>{" "}
          uses <code>location=canonical_name</code> &amp; <code>gl=CC</code>.{" "}
          <span className="text-neutral-700 dark:text-neutral-200 font-medium">
            Bright Data Google
          </span>{" "}
          uses <code>gl=CC</code> &amp; the computed <code>uule=</code> below.{" "}
          <span className="text-neutral-700 dark:text-neutral-200 font-medium">
            Oxylabs Google
          </span>{" "}
          uses <code>geo_location=canonical_name</code> (best-effort match
          against Oxylabs&rsquo; own DB; falls back to country if the city
          isn&rsquo;t recognized).{" "}
          <span className="text-neutral-700 dark:text-neutral-200 font-medium">
            Yandex
          </span>{" "}
          (any provider) uses <code>lr=yandex_lr</code>.
        </>
      ),
      cols: {
        canonical: "canonical_name",
        name: "Name",
        cc: "CC",
        type: "Type",
        yandexLr: "yandex_lr",
        uule: "uule (Bright Data Google)",
      },
      empty: "No locations match.",
      deleteConfirm: "Delete this location?",
      copyUuleTitle: "Copy full UULE",
    },
    aiAnalysis: {
      title: "AI SERP difficulty",
      help:
        "The prompt used to judge each keyword. The model receives one united table per keyword — every ranking result with its Ahrefs metrics on the same row — and returns a difficulty plus a 1-3 sentence comment. Your edits are never overwritten by an update.",
      customised: "customised",
      usingDefault: "using default",
      providerLabel: "Provider for scoring",
      providerAuto: "Auto (the one configured provider)",
      providerOff: "Off — collect metrics only",
      promptLabel: "Prompt",
      placeholders: "Available placeholders: {keyword} and {table}. Both are filled in at run time. The prompt can be written in any language — only the free-text comment follows it; the difficulty value stays low/medium/hard/too hard and the UI translates it.",
      reset: "Reset to default",
      loadRu: "Load Russian version",
      domainTitle: "Domain-level section",
      domainHelp: "Guidance placed above the domain table. Only used when a job has domain metrics selected. Edit it to tune how the model separates real authority sites from PBN networks — the organic-keyword columns are the strongest tell. Optional {domain_table} placeholder controls where the table goes; otherwise it is appended.",
      domainReset: "Reset domain section",
      domainLoadRu: "Load Russian version",
      unsaved: "Unsaved — press Save to apply",
      resetConfirm:
        "Discard your customised prompt and go back to the built-in default?",
      resetDone: "Reset to the built-in default.",
    },
    ahrefs: {
      title: "Ahrefs",
      help:
        "Powers the SERP analyzer mode: link metrics for every result URL, pulled via /batch-analysis in exact-URL mode. Get an API key from ahrefs.com/api.",
      apiKey: "API key",
      apiKeyPlaceholder: "Ahrefs API token",
      clearConfirm: "Clear the stored Ahrefs API key?",
      testOk: (units: number) => `✓ Works — test call billed ${units} unit(s)`,
      footnote:
        "Ahrefs has no free credential check, so Test runs one real single-target lookup (~1 unit). Analyzer runs bill roughly 1 unit per URL per selected metric; duplicate URLs within a run are fetched once.",
    },
    ai: {
      title: "AI providers",
      help:
        "Gemini access for the SERP Analyzer's difficulty verdict. Set up one provider and test it here; the analyzer jobs use it.",
      authServiceAccount: "service account",
      authExpress: "Express (API key)",
      testing: "Testing…",
      testOk: (model: string) => `✓ Works — model ${model}`,
      testTokens: (p: number, c: number) => `${p} prompt + ${c} output tokens`,
      testNote:
        "Neither Google API offers a free credential check, so Test runs a real one-word generation — a few tokens. Output tokens include Gemini's thinking tokens, which are billed at the output rate.",
      clearConfirm: (provider: string) =>
        `Clear all stored settings for ${provider}?`,
      meta: {
        common: {
          model: { label: "Default model" },
        },
        ai_studio: {
          help:
            "Simplest setup: one API key from aistudio.google.com/apikey. Good for testing and low volume; quotas are per-key and generous on the free tier.",
          api_key: { label: "API key", placeholder: "AIza…" },
        },
        vertex: {
          help:
            "Two ways in. Service-account JSON + project + location is the production path with real quota. Vertex Express (API key alone) is quicker to set up but tightly rate-limited. If both are filled, the service account wins. Gemini models only.",
          service_account_json: {
            label: "Service-account JSON",
            placeholder: '{"type":"service_account","project_id":"…","private_key":"…"}',
          },
          project_id: { label: "Project ID" },
          location: { label: "Location (region)" },
          api_key: { label: "Express API key (alternative)", placeholder: "AIza…" },
        },
      },
    },
    visibility: {
      title: "Visibility weights",
      help:
        "What each SERP slot is worth, as a share of the page. Used for the Visibility column on a project's averaged positions. The defaults are steep — half the page in the first slot — because this tool watches branded queries, where #1 takes a share it never would on a research query.",
      isDefault: "default curve",
      customised: "customised",
      colPosition: "Position",
      colWeight: "Weight",
      colShare: "Share of page",
      colCumulative: "Top N hold",
      addSlot: "+ slot",
      removeSlot: "− slot",
      depth: (n: number) => `${n} slot(s) — anything below #${n} counts as invisible`,
      allZero: "At least one weight has to be above zero, or nothing on the page is worth anything.",
      reset: "Restore defaults",
      footnote:
        "Only the ratios matter: 5/2/1 says the same as 50/20/10, because every score is divided by the weight in play on the page being measured. That also calibrates short pages — a SERP with seven results divides the same total between those seven slots. Gaps left by ads are not redistributed: that attention went to the ad. Changing the curve re-scores every view immediately, including past runs — this is a way of reading the measurements, not part of them.",
    },
    rates: {
      title: "Cost rates",
      help:
        "What you pay per search, per provider. Used for the cost estimate on the job form and for run costs where the provider doesn't report a real figure. Rates depend on your plan — set your actual ones here.",
      usingDefault: "using default",
      defaultIs: (v: string) => `default: $${v}`,
      footnote:
        "DataForSEO reports its real cost per request, so its runs record actual spend and ignore this rate. SerpAPI, Bright Data and Oxylabs don't return a price, so their runs are estimated from the rate above. Clear a field to restore its default.",
    },
    providers: {
      title: "Providers",
      configured: "configured",
      partial: "partial",
      notSet: "not set",
      savedSecret: (last4: string, length: number) => (
        <>
          Saved: <code>••••{last4}</code> ({length} chars)
        </>
      ),
      savedPlain: (value: string) => (
        <>
          Saved: <code>{value}</code>
        </>
      ),
      savedNoDetail: "Saved.",
      worksOk: (provider: string) => `✓ ${provider} works.`,
      plan: (plan: string) => (
        <>
          {" "}Plan: <strong>{plan}</strong>.
        </>
      ),
      searchesLeft: (n: number) => (
        <>
          {" "}Searches left: <strong>{n}</strong>.
        </>
      ),
      balance: (n: number) => (
        <>
          {" "}Balance: <strong>${n}</strong>.
        </>
      ),
      clearConfirm: (provider: string) =>
        `Clear all stored credentials for ${provider}?`,
      meta: {
        serpapi: {
          help: "Default provider. Get a key at serpapi.com/manage-api-key. The DB value overrides SERPAPI_KEY from .env.",
          api_key: { label: "API key", placeholder: "Paste SerpAPI key…" },
        },
        brightdata: {
          help:
            "Two zones recommended: `zone` set to Full JSON for Google, `zone_raw` set to Raw HTML for Yandex (Bright Data's Full-JSON parser doesn't cover Yandex on most plans, so we fetch the page and parse it ourselves). Leave `zone_raw` blank if you only need Google.",
          token: {
            label: "API token",
            placeholder: "Bearer token from Bright Data dashboard",
          },
          zone: {
            label: "Zone (Full JSON, for Google)",
            placeholder: "e.g. serp_api1",
          },
          zone_raw: {
            label: "Zone (Raw HTML, for Yandex) — optional",
            placeholder: "e.g. serp_raw",
          },
        },
        oxylabs: {
          help: "SERP Scraper API at realtime.oxylabs.io. Use the username and password from your Oxylabs SERP Scraper sub-account.",
          username: { label: "Username", placeholder: "Oxylabs SERP username" },
          password: { label: "Password", placeholder: "Oxylabs password" },
        },
        dataforseo: {
          help:
            "Google only — DataForSEO has no Yandex endpoint. Live mode (~$0.002 per search, results in a few seconds). Credentials come from app.dataforseo.com/api-access; the API password is auto-generated and is NOT your account password. Testing is free (checks your balance without spending credit).",
          login: { label: "Login (email)", placeholder: "you@example.com" },
          password: { label: "API password", placeholder: "Auto-generated API password" },
        },
      },
    },
  },
  combobox: {
    searching: "Searching…",
    noMatches: "No matches.",
  },
  cost: {
    estimated: "est.",
    actualHint: "Actual cost reported by the provider",
    estimateHint: "Estimated: queries × the rate configured in Settings",
  },
  compare: {
    title: "Provider comparison",
    subtitle: "The same queries, sent to every provider",
    summaryTitle: "Providers",
    colProvider: "Provider",
    colAnswered: "Answered",
    colFailed: "Failed",
    colUnsupported: "Not supported",
    colRetried: "Retried",
    retriedHint:
      "Queries that needed more than one try. Transient provider failures — an empty response, a faulted job, a captcha page — are retried automatically, up to 3 tries, before a query counts as failed.",
    answeredOnAttempt: (n: number) => `Answered on try ${n} — the earlier tries failed and were retried automatically.`,
    colResults: "Results",
    colAvgResults: "Avg per SERP",
    colCost: "Cost",
    answeredOf: (ok: number, total: number) => `${ok} of ${total}`,
    retry: (n: number) => `Retry ${n} failed`,
    retrying: "Retrying…",
    basis: (common: number, total: number) =>
      common === total
        ? total === 1
          ? "Domains and URLs below come from the one query in this run — every provider answered it."
          : `Domains and URLs below are totalled over all ${total} queries — every provider answered each one.`
        : `Domains and URLs below are totalled over the ${common} of ${total} queries every provider answered. The rest are left out so that one provider's failed request does not read as missing domains — they are in “Results per SERP”.`,
    nobodyAnswered: (engine: string) =>
      `No provider answered any ${engine} query, so there is nothing to compare yet.`,
    onlyOneAnswered: (engine: string) =>
      `Only one provider answered ${engine} queries, so there is nothing to compare it with.`,
    noAnswers: "no answers",
    noAnswersHint: "Every request to this provider failed for this engine, so it is left out of the comparison.",
    onlyDifferences: "Only differences",
    shownHostOn:
      "This job resolves AMP and CDN results to the site shown, so domains are counted as the engine displayed them — providers that report the delivery host and providers that report the publisher then line up. URLs are still compared as linked. Resolved results are marked ⇄.",
    substitutedRow: (from: string) => `Counted as the displayed site. Linked from: ${from}`,
    domainsTitle: "Domains",
    urlsTitle: "URLs",
    countsTitle: "Results per SERP",
    colDomain: "Domain",
    colUrl: "URL",
    colFoundBy: "Found by",
    colQuery: "Query",
    cellHint: (count: number, avg: string, best: number) =>
      `${count} ${count === 1 ? "result" : "results"} · average position ${avg} · best ${best}`,
    notReturned: "not returned by this provider",
    statusFailed: "failed",
    statusUnsupported: "n/a",
    statusUnsupportedHint: "This provider cannot run this engine; the query was never sent.",
    statusPending: "…",
    statusPendingHint: "No answer recorded yet.",
    noRows: "Nothing to show.",
    noDifferences: "No differences — every provider agrees.",
    keywordsTitle: "SERPs by keyword",
    keywordSummary: (queries: number, differing: number) =>
      `${queries} ${queries === 1 ? "query" : "queries"} · ${differing ? `${differing} with differences` : "no differences"}`,
    colPosition: "#",
    legendTitle: "Highlighting",
    markSame: "In every provider’s SERP",
    markPage: "Same site elsewhere, different page",
    markSite: "Site missing from another provider’s SERP",
    serpFailed: "Request failed",
    serpEmpty: "Empty SERP",
    serpUnsupported: "Not supported",
    footnote:
      "URLs are matched ignoring http/https, a leading www., a trailing slash and the #fragment, because providers disagree on those for the very same page. Domains ignore www. Everything else — the path and the query string — has to match.",
  },
};

type Messages = typeof messagesEn;

const messagesRu: Messages = {
  appName: "SERP Monitor",
  langName: { en: "EN", ru: "RU" },
  langSwitchTitle: "Язык",
  themeSwitchToLight: "Переключить на светлую тему",
  themeSwitchToDark: "Переключить на тёмную тему",
  common: {
    loading: "Загрузка…",
    cancel: "Отмена",
    save: "Сохранить",
    saved: "Сохранено.",
    cleared: "Очищено.",
    test: "Проверить",
    clear: "Очистить",
    edit: "Изменить",
    open: "Открыть",
    rename: "Переименовать",
    delete: "Удалить",
    add: "Добавить",
    import: "Импортировать",
    copy: "Скопировать",
    copyAll: "Скопировать всё",
    download: "Скачать",
    filter: "Фильтр…",
    yourTime: "ваше время",
    close: "Закрыть",
    optional: "(необязательно)",
  },
  nav: {
    jobs: "Задачи",
    projects: "Проекты",
    newJob: "Новая задача",
    settings: "Настройки",
    docs: "Документация",
  },
  home: {
    title: "Задачи",
    searchPlaceholder: "Поиск по названию или ключу…",
    allProjects: "Все проекты",
    ungrouped: "Без проекта",
    noMatches: "По этому запросу ничего нет.",
    showing: (from: number, to: number, total: number) =>
      `${from}–${to} из ${total}`,
    prev: "← Назад",
    next: "Вперёд →",
    newJob: "+ Новая задача",
    empty: "Задач пока нет. Создайте первую.",
    run: "Запустить",
    renamePrompt: "Новое название?",
    deleteConfirm: (name: string) =>
      `Удалить «${name}» и все её запуски?`,
    kwCount: (n: number) =>
      `${n} ${pluralRu(n, ["ключевое слово", "ключевых слова", "ключевых слов"])}`,
    locCount: (n: number) =>
      `${n} ${pluralRu(n, ["локация", "локации", "локаций"])}`,
    langCount: (n: number) =>
      `${n} ${pluralRu(n, ["язык", "языка", "языков"])}`,
  },
  jobs: {
    newTitle: "Новая задача",
    editPrefix: (name: string) => `Изменение: ${name}`,
    runNow: "Запустить сейчас",
    fields: {
      provider: "Провайдер",
      providers: "Провайдеры",
      keywords: "Ключевые слова",
      engines: "Поисковики",
      devices: "Устройства",
      languages: "Языки",
      locations: "Геолокации",
      googleDomains: "Домены Google",
      topN: "Топ N",
      schedule: "Расписание",
    },
    keywordsCount: (n: number) =>
      `${n} ${pluralRu(n, ["ключевое слово", "ключевых слова", "ключевых слов"])}`,
    autoFallback: "авто",
    runs: "Запуски",
    noRuns: "Запусков пока нет.",
    totalCost: (total: string, n: number) =>
      `${total} всего за ${n} ${pluralRu(n, ["запуск", "запуска", "запусков"])}`,
    runEntry: {
      runLabel: (id: number) => `Запуск №${id}`,
      progress: (done: number, total: number) =>
        `${done}/${total} ${pluralRu(total, ["выполнен", "выполнено", "выполнено"])}`,
      failed: (n: number) =>
        `${n} ${pluralRu(n, ["ошибка", "ошибки", "ошибок"])}`,
    },
    schedule: {
      enabled: "включено",
      disabled: "выключено",
      cronInTz: (tz: string) => (
        <>
          часовой пояс cron — <strong>{tz}</strong>
        </>
      ),
      notRegistered:
        "⚠ не зарегистрировано в планировщике — попробуйте переключить и сохранить ещё раз",
      nextRun: (when: string) => (
        <>
          Следующий запуск: <strong>{when}</strong> (ваше время)
        </>
      ),
    },
    statusBadge: {
      pending: "ожидает",
      running: "выполняется",
      done: "завершено",
      failed: "ошибка",
      canceled: "отменено",
    },
  },
  report: {
    open: "Отчёт",
    title: "Отчёт по точкам роста в выдаче",
    subtitle: (market: string, date: string) => `${market} · ${date}`,
    lang: "Язык отчёта",
    download: "Скачать PDF",
    downloading: "Формируем PDF…",
    filename: (job: string, run: number) => `${job || "otchet"}-zapusk${run}.pdf`,
    page: (current: number, total: number) => `${current} / ${total}`,
    controls: "Настройки отчёта",
    summary: "Кратко",
    analysed: "Проанализировано запросов",
    shortlisted: "Выбрано ключей",
    reachableVolume: "Показов в месяц в шорт-листе",
    shortlistTitle: "С чего начать",
    shortlistLead: (n: number) =>
      `${n} запросов с лучшим соотношением спроса и того, насколько выдачу реально взять.`,
    colRank: "№",
    colKeyword: "Запрос",
    colVolume: "Частотность",
    colDifficulty: "Сложность SERP",
    colBar: "Порог входа",
    colBarRd: "Порог по Refdomains",
    colSoft: "Слабых позиций",
    colScore: "Потенциал",
    legendDifficulty:
      "вердикт AI по выдаче целиком — кто занимает верхние позиции и насколько сильны эти страницы.",
    legendBar: (depth: number) =>
      (depth === 0
        ? "средний DR самых слабых доменов в выдаче"
        : `средний DR самых слабых доменов в топ-${depth}`) +
      " — уровень, до которого достаточно дотянуться, чтобы бороться за позицию.",
    legendBarRd:
      "тот же порог в ссылающихся доменах — среднее по тем же самым слабым конкурентам, но по сайтам, а не по страницам: сколько примерно доноров нужно, чтобы конкурировать.",
    legendScore:
      "0-100. Спрос, взвешенный с тем, насколько выдачу реально взять: начинать стоит с верха списка.",
    detailTitle: "Разбор по запросам",
    competitors: "Кого предстоит подвинуть",
    noDomains: "Для этого запроса домены не выбраны.",
    aiComment: "Комментарий аналитика",
    colDomain: "Домен",
    colAge: "Возраст",
    colBacklinks: "Бэклинков",
    colRefdomains: "Ссыл. доменов",
    colKeywordsTop: "Ключей в топ-3",
    colKeywords410: "Ключей 4-10",
    keywordPicker: "Запросы в отчёте",
    domainPicker: "Показывать домены",
    domainPickerHint:
      "Снятые галочки убирают домен из всех таблиц. Крупные площадки вроде youtube и wikipedia обычно только шумят.",
    inKeywords: (n: number) => `${n} зап.`,
    selectAll: "Все",
    selectNone: "Ничего",
    footer: (job: string, run: number) => `${job} · запуск №${run}`,
    empty: "Отчитываться не о чем — ни у одного запроса нет одновременно частотности и вердикта.",
  },
  aiTuning: {
    tuningTitle: "Настройка модели",
    tuningHelp:
      "Как AI-судья сэмплирует ответ. Замерено на реальной выдаче с идентичным промптом, по 8 прогонов на настройку.",
    temperature: "Креативность (temperature)",
    temperatureHelp:
      "Замер: заметного влияния нет. При 0.0 и при 1.5 вердикты распределились одинаково, а формулировки каждый раз были новыми — то есть повышение не добавляет разнообразия, а понижение не добавляет детерминированности.",
    thinking: "Бюджет рассуждений (токены)",
    thinkingHelp:
      "Замер: именно эта настройка и решает. При 0 судья назвал выдачу «средней» 7 раз из 8; при 1024 — «высокой» 8 раз из 8, верно взвесив, что паразитные страницы на новостных доменах с DR 77 сместить трудно, несмотря на пустой ссылочный профиль страниц. Стоит примерно втрое больше выходных токенов. 0 отключает рассуждения.",
    maxTokens: "Лимит ответа (токены)",
    maxTokensHelp:
      "Рассуждения тарифицируются из того же лимита, поэтому он автоматически поднимается, чтобы осталось место под ответ. Слишком низкий лимит при включённых рассуждениях — модель потратит всё на размышления и вернёт пустоту.",
  },
  formula: {
    title: "Формула перспективности",
    subtitle:
      "Как ранжируются ключевые слова в запуске. Здесь задаются значения по умолчанию; любой запуск может их переопределить.",
    equation:
      "Перспективность = (Частотность^wv × Шансы^ww)^½ · Шансы = Порог × Слабые × AI",
    groups: {
      difficulty: "Сложность выдачи",
      slots: "Сила позиций",
      winnability: "Порог входа",
      ranking: "Ранжирование",
    } as Record<string, string>,
    groupHints: {
      difficulty: "На что вердикт AI умножает шансы. Именно множитель, а не слагаемое — поэтому вердикт может перечеркнуть выдачу, которую метрики считают лёгкой.",
      slots: "Где позиция перестаёт быть слабой и становится сильной. Задаёт и цвета столбиков, и счётчик слабых позиций.",
      winnability: "Как самые слабые конкуренты и слабые позиции превращаются в оценку шансов.",
      ranking: "Как частотность и шансы складываются в итоговую оценку.",
    } as Record<string, string>,
    labels: {
      ai_low: "AI: низкая",
      ai_medium: "AI: средняя",
      ai_hard: "AI: высокая",
      ai_too_hard: "AI: очень высокая",
      ai_unknown: "AI: без вердикта",
      bar_dr_ceiling: "Потолок DR порога входа",
      soft_floor: "Минимум фактора слабых позиций",
      min_weight: "Минимальный вес",
      balance: "Баланс по умолчанию",
      shortlist: "Размер шорт-листа",
      ur_soft: "Слабая позиция: UR ниже",
      ur_strong: "Сильная позиция: UR от",
      dr_soft: "Слабый домен: DR ниже",
      dr_strong: "Сильный домен: DR от",
      volume_curve: "Кривая частотности",
    } as Record<string, string>,
    hints: {
      ai_low: "Множитель, когда AI считает выдачу берущейся",
      ai_medium: "Множитель для средней сложности",
      ai_hard: "Множитель для высокой сложности",
      ai_too_hard: "Поставьте 0, чтобы полностью исключать такие слова",
      ai_unknown: "Применяется, если AI не оценил слово",
      bar_dr_ceiling: "DR, при котором выдача считается закрытой. Меньше — строже",
      soft_floor: "Нижняя граница фактора слабых позиций. 1 отключает его",
      min_weight: "Не даёт фактору обнулиться на краях ползунка",
      balance: "Стартовое положение ползунка «быстрые победы ↔ крупные цели»",
      shortlist: "Сколько верхних слов подсвечивать",
      ur_soft: "У страницы ниже этого значения своих ссылок практически нет",
      ur_strong: "От этого значения страница действительно прокачана ссылками",
      dr_soft: "Пустая страница на домене ниже этого DR — слабая; выше — «за счёт домена»",
      dr_strong: "Используется, только если лестницу задаёт DR, а не UR",
      volume_curve: "sqrt сглаживает крупные слова · linear даёт им доминировать · log сглаживает сильнее всего",
    } as Record<string, string>,
    revertTo: (v: string) => `Вернуть ${v}`,
    resetGlobal: "Сбросить к встроенным значениям",
    runTitle: "Формула для этого запуска",
    runInherited: "Используется глобальная формула",
    runOverridden: "⚠ Этот запуск переопределяет глобальную формулу",
    runSaveOverride: "Сохранить для запуска",
    runClearOverride: "Вернуть глобальную",
    edit: "Формула",
  },
  analysis: {
    title: "Анализ выдачи",
    subtitle: (depth: number, ranker: string) =>
      depth === 0
        ? `Порог входа по всей выдаче — среднее по самым слабым доменам по ${ranker}`
        : `Порог входа в топ-${depth} — среднее по самым слабым доменам по ${ranker}`,
    depthLabel: "Цель",
    depthOption: (n: number) => `Топ-${n}`,
    depthAll: "Вся",
    colKeyword: "Ключевое слово",
    colShape: "Профиль выдачи",
    colSoft: "Слабых позиций",
    colVolume: (market: string) => (market ? `Частотность (${market})` : "Частотность"),
    volumeGeoNote: (market: string) =>
      `По стране целиком (${market}) — сервисы дают частотность по странам, а не по городам`,
    volumeCityHint: (market: string) =>
      `Этот запуск нацелен на город или регион, но частотность бывает только на уровне страны. Значение — по всему рынку ${market}: город здесь лишь точка съёма выдачи, а не размер рынка.`,
    volumeMultiCountry: (used: string, others: string) =>
      `⚠ В этом запуске есть не только ${used}, но и ${others}. Оценки считают спрос только по ${used} — остальные рынки не учитываются.`,
    colOpportunity: "Перспективность",
    colCoverage: "Проанализировано",
    colDifficulty: "Сложность выдачи",
    colComment: "Комментарий AI",
    difficultyPending: "—",
    difficultyLabels: {
      low: "низкая",
      medium: "средняя",
      hard: "высокая",
      "too hard": "очень высокая",
    } as Record<string, string>,
    aiFailed: "ошибка AI",
    aiMissing: (judged: number, total: number) =>
      `Вердикт AI есть у ${judged} из ${total} запросов.`,
    aiRescoreHint:
      "Выдача, метрики Ahrefs и возраст доменов уже сохранены — оценка остальных стоит только токенов AI, ничего не пересобирается и не оплачивается заново.",
    aiRescore: (n: number) => `Оценить оставшиеся: ${n}`,
    aiRescoring: "Оцениваем…",
    empty: "Анализа пока нет. Запустите задачу, чтобы собрать метрики Ahrefs.",
    units: (n: number) => `${n.toLocaleString()} юнитов Ahrefs`,
    ahrefsCache: (cached: number, fetched: number) =>
      cached > 0 ? `· ${cached} из ${cached + fetched} из кэша` : "",
    ahrefsCacheHint: (cached: number, fetched: number, ttl: number) =>
      `${cached} целей уже были измерены за последние ${ttl} дн. и переиспользованы; ${fetched} докуплено. Метрики Ahrefs меняются, поэтому кэшированным значениям может быть до ${ttl} дн. — уменьшите TTL в настройках, если следите за динамикой по дням.`,
    partialHint: "Часть URL на этой глубине не удалось проанализировать",
    cellHint: (metric: string, from: number, of: number, ranker: string, positions: string) =>
      from < of
        ? `Среднее ${metric} по ${positions} — ${of} самых слабых домена по ${ranker}. Метрику вернули только ${from} из них.`
        : `Среднее ${metric} по ${positions} — ${of} самых слабых домена по ${ranker}`,
    cohortLabel: (positions: string) => `слабейшие: ${positions}`,
    cohortHint: (size: number, ranker: string) =>
      `${size} самых слабых по ${ranker} домена на этой глубине, по одной странице с каждого — все числа в строке усреднены по ним`,
    inCohort: "в расчёте",
    bandCount: (band: string, n: number) => {
      const forms: Record<string, [string, string, string]> = {
        soft: ["слабая", "слабые", "слабых"],
        propped: ["за счёт домена", "за счёт домена", "за счёт домена"],
        moderate: ["средняя", "средние", "средних"],
        strong: ["сильная", "сильные", "сильных"],
        unknown: ["без данных", "без данных", "без данных"],
      };
      const f = forms[band];
      return f ? `${n} ${pluralRu(n, f)}` : `${n} ${band}`;
    },
    softHint: (soft: number, total: number, breakdown: string) =>
      `${soft} из ${total} позиций — слабые страницы на слабых доменах, то есть реальные цели. Полный расклад: ${breakdown}`,
    coverageHint: (analysed: number, total: number) =>
      `Ahrefs вернул метрики для ${analysed} из ${total} страниц на этой глубине`,
    exportCsv: "Выгрузить таблицу",
    exportHint: "Скачать эти строки в CSV на показанной глубине",
    exportNoColumns: "Выберите хотя бы один столбец для выгрузки",
    csvColumns: "Столбцы",
    csvColumnsTitle: "Столбцы для выгрузки",
    csvColumnsHint:
      "Отмеченные столбцы попадут в CSV. Строка заголовков внизу показывает точный порядок, в котором они будут записаны. Выбор запоминается между прогонами; метрика, добавленная в будущем прогоне, выгружается, пока вы её не снимете.",
    csvSelectAll: "Все",
    csvSelectDefault: "По умолчанию",
    csvSelectNone: "Ничего",
    csvSelected: (on: number, all: number) => `${on} из ${all}`,
    csvHeaderPreview: "Строка заголовков",
    csvGroupLabels: {
      keyword: "Запрос и частотность",
      score: "Перспективность",
      shape: "Профиль выдачи",
      metrics: "Порог входа",
      slots: "Позиции",
      ai: "Вердикт AI",
    } as Record<string, string>,
    csvColumnLabels: {
      keyword: "Ключевое слово",
      opportunity: "Оценка перспективности",
      opportunity_rank: "Место в шорт-листе",
      volume: "Частотность",
      volume_country: "Страна частотности",
      winnability: "Проходимость",
      depth: "Глубина выгрузки",
      cohort_size: "Размер когорты",
      ranked_by: "Когорта отобрана по",
      cohort_positions: "Позиции когорты",
      cohort_domains: "Домены когорты",
      soft_slots: "Слабых позиций",
      domain_carried_slots: "Позиций за счёт домена",
      moderate_slots: "Средних позиций",
      strong_slots: "Сильных позиций",
      slots_analysed: "Проанализировано позиций",
      slots_total: "Всего позиций",
      ai_difficulty: "Сложность выдачи",
      ai_comment: "Комментарий AI",
    } as Record<string, string>,
    csvMetricAverage: (metric: string) => `${metric} — среднее по когорте`,
    csvPagesAveraged: (metric: string) => `${metric} — по скольким страницам усреднено`,
    balanceQuick: "быстрые победы",
    balanceVolume: "крупные цели",
    balanceHint: (pct: number) =>
      `Перспективность — взвешенное среднее геометрическое частотности и шансов взять выдачу. ` +
      `Вес частотности ${pct}%, шансов — ${100 - pct}%. Влево — выдачи, которые можно взять быстро; вправо — максимум трафика, который реально выиграть.`,
    volumeAdd: "+ добавить",
    pasteVolumes: "Вставить частотности",
    pasteTitle: "Вставить частотности из Ahrefs",
    pasteHelp: (market: string) =>
      `Скопируйте строки прямо из Keywords Explorer или CSV-экспорта — вместе с заголовком. Сохранится для рынка ${market || "этого запуска"}.`,
    pastePlaceholder: `Keyword	Country	Difficulty	Volume	CPC
melbet	kz	34	20 000	0,45`,
    pasteColumns: (kw: string, vol: string) =>
      `Ключевое слово берётся из «${kw}», частотность — из «${vol}».`,
    pasteNoHeader:
      "Строка заголовка не найдена — каждая строка читается как «ключевое слово … число». Вставьте заголовок, если колонка определилась неверно.",
    pasteWrongCountry: (found: string, market: string) =>
      `⚠ Эти данные для ${found}, а рынок запуска — ${market}. Частотность в Ahrefs даётся по странам: проверьте, ту ли страну выгрузили.`,
    pasteMatched: (n: number) => `Готово к сохранению: ${n}.`,
    pasteUnmatched: (n: number, names: string) =>
      `${n} нет в этом запуске — будут пропущены: ${names}`,
    pasteSkipped: (n: number) => `Строк без пригодного числа: ${n} — пропущены.`,
    pasteMissing: (n: number, names: string) =>
      `Без частотности в этом запуске осталось: ${n} — ${names}`,
    pasteApply: (n: number) => (n ? `Сохранить: ${n}` : "Нечего сохранять"),
    volumeEmpty: "Частотность не указана — оценить это слово нельзя. Нажмите, чтобы добавить.",
    volumeAnyCountry: "любая страна",
    volumeHint: (country: string) =>
      `Показов в месяц (${country}). Хранится по ключевому слову и переиспользуется во всех запусках по этому рынку — нажмите, чтобы изменить.`,
    oppNeedsVolume: "нужна частотность",
    oppNoVolume: "Укажите частотность, чтобы оценить это слово",
    oppHint: (vol: number, win: number, bar: number, soft: number, ai: number) =>
      `Частотность — ${vol}% от максимума в запуске · шансы — ${win}% ` +
      `(порог входа ${bar}% × слабые позиции ${soft}% × вердикт AI ×${ai}). ` +
      `Оценки относительны внутри запуска: они отвечают на вопрос «что брать первым», а не «хорошо ли это слово».`,
    noneInDepth: "На этой глубине результатов нет",
    bandLabels: {
      soft: "слабая",
      propped: "за счёт домена",
      moderate: "средняя",
      strong: "сильная",
      unknown: "нет данных",
    } as Record<string, string>,
    bandHints: {
      soft: "Слабая страница на слабом домене — реальная цель для вытеснения",
      propped: "У самой страницы ссылок нет, её вытягивает сильный домен",
      moderate: "У страницы есть какой-то ссылочный вес",
      strong: "Действительно хорошо прокачанная страница",
      unknown: "Не проанализировано",
    } as Record<string, string>,
    gapHint: (pos: number) =>
      `#${pos} — органики здесь нет (позицию занял блок рекламы или колдунщик)`,
    legendTitle: "Высота столбика — сила страницы · цвет —",
    promptTitle: "Промпт, отправленный в AI",
    promptHint:
      "Ровно то, что модель получила по этому ключевому слову; записано до вызова. Включает таблицу выдачи, метрики и доменный блок.",
    promptMeta: (model: string, inTok: number | null, outTok: number | null) =>
      [model, inTok != null ? `${inTok.toLocaleString()} вход` : null,
       outTok != null ? `${outTok.toLocaleString()} выход` : null]
        .filter(Boolean).join(" · "),
    promptCopy: "Скопировать промпт",
    promptCopied: "Скопировано",
    promptNone:
      "Промпт не сохранён — этот запуск сделан до включения логирования. Перезапустите задачу, чтобы он записался.",
    promptResponse: "Ответ модели",
    rawTitle: "Сырые данные Ahrefs по каждому URL этой выдачи",
    rawDomainTitle: "Метрики уровня домена для сайтов выше",
    colDomain: "Домен",
    colAge: "Возраст",
    colRegistrar: "Регистратор",
    ageHint: (created: string, registrable: string) =>
      `Зарегистрирован ${created} (${registrable})`,
    ageSubdomainHint: (created: string, registrable: string) =>
      `Поддомен — это возраст ${registrable}, зарегистрирован ${created}`,
    ageUnknownHint: "Запись о регистрации не найдена — ни в RDAP, ни в DataForSEO",
    ageNoDateHint:
      "Запись о регистрации есть, но реестр не публикует дату создания. Это бывает у части ccTLD — домен не новый, просто возраст неизвестен.",
    whoisSpend: (usd: string, perDomain: string) => `WHOIS ${usd} · ${perDomain}/домен`,
    whoisCached: "WHOIS из кэша · бесплатно",
    whoisSpendHint: (fetched: number, cached: number, usd: string, perDomain: string) =>
      `Запрошено доменов: ${fetched}${cached ? `, ещё ${cached} взято из кэша` : ""}. ` +
      `DataForSEO берёт фиксированные ~$0,12 за запрос плюс ~$0,0012 за домен, поэтому ${usd} ` +
      `на таком объёме дают ${perDomain} за домен. Плата идёт за ЗАПРОС, а не за домен — ` +
      `чем больше доменов в одном вызове, тем дешевле каждый.`,
    whoisCachedHint: (domains: number) =>
      `Все ${domains} домен(ов) взяты из кэша — даты регистрации не меняются, поэтому регулярная задача платит только за домены, которых ещё не видела.`,
    colPos: "#",
    alsoAt: (positions: string) => `также на ${positions}`,
    analyzedAs: "проанализирован как",
    notAnalysed: "не проанализирован",
    fetchFailed: "ошибка запроса",
    footnote:
      "Все числа в строке — среднее по ОДНИМ И ТЕМ ЖЕ самым слабым конкурентам: двум на ограниченной глубине и трём по всей выдаче. Они перечислены под столбиками и отмечены точкой. Больше одного, потому что одна самая слабая страница — это лотерея; по DR, а не по каждой метрике отдельно, потому что поколоночный минимум выбирает в каждом столбце свою страницу и позволяет авторитетному домену с пустым ссылочным профилем страницы задавать «самую лёгкую» планку по бэклинкам, которой он на деле не является. По одной странице с домена: DR принадлежит сайту, поэтому сайт, занявший два места, иначе занял бы собой весь расчёт. В расчёт попадают только проанализированные страницы, а звёздочка означает, что среднее посчитано по меньшему числу страниц, чем в наборе. URL анализируются в режиме точного URL (exact), поэтому UR относится к странице, а не к домену; AMP- и трекинговые варианты предварительно приводятся к каноническому URL, поскольку Ahrefs считает их отдельными страницами с пустым ссылочным профилем. Если ключевое слово снималось по нескольким движкам, устройствам или локациям, страница ставится на ЛУЧШУЮ из своих позиций. Кликните по ключевому слову, чтобы увидеть сырые данные по каждому URL.",
  },
  projects: {
    tabs: { overview: "Обзор", positions: "Позиции", blocks: "Блокировки", uploads: "Загрузки CSV" },
    title: "Проекты",
    lead: "Проект хранит домены, которые вы отслеживаете для клиента или сайта. Он же — папка, по которой группируется список задач: назначьте задаче проект, и она попадёт туда.",
    newProject: "Новый проект",
    newJob: "Новая задача",
    viewJobs: "Задачи",
    create: "Создать проект",
    empty: "Проектов пока нет. Создайте проект, чтобы сгруппировать задачи и хранить отслеживаемые домены.",
    name: "Название проекта",
    namePlaceholder: "напр. Acme Casino — KZ",
    nameRequired: "Нужно указать название.",
    domains: "Домены",
    domainsHint: "(вставляйте в любом виде — по одному на строку, через запятую или целые URL)",
    domainsPlaceholder: "example.com\nhttps://www.example.kz/promo\nkz.example.com",
    domainsCount: (n: number) => `доменов: ${n}`,
    domainsDuplicates: (n: number) => `дубликатов убрано: ${n}`,
    domainsRejected: (n: number, sample: string) =>
      `не распознано как домен и не будет сохранено (${n}): ${sample}`,
    notes: "Заметки",
    jobsCount: (n: number) => `задач: ${n}`,
    andMore: (n: number) => `ещё ${n}`,
    showAllDomains: (n: number) => `ещё ${n} — показать все`,
    showFewerDomains: "свернуть",
    deleteConfirm: (name: string, jobs: number) =>
      jobs > 0
        ? `Удалить проект «${name}»? Задачи (${jobs}) сохранятся — они станут без проекта, вместе со всеми прогонами и расписанием.`
        : `Удалить проект «${name}»?`,
  },
  positions: {
    title: "Позиции",
    allProjects: "Все проекты",
    presets: {
      today: "Сегодня",
      yesterday: "Вчера",
      week: "Эта неделя",
      month: "Этот месяц",
      year: "Этот год",
      custom: "Свой период",
    } as Record<string, string>,
    badRange: "Укажите обе даты — конец не может быть раньше начала.",
    tracking: {
      toggle: "Отслеживание позиций",
      toggleHint: "Вид как в трекерах позиций: сколько позиций в каждом топе и каждый URL проекта — с лучшей и средней позицией и тем, как он сдвинулся.",
      overview: "Обзор",
      distribution: "Распределение позиций",
      distributionAbout:
        "Сколько позиций проекта в каждой полосе мест — по последней проверке каждого запроса за период. Каждый столбец — своя полоса (Топ 3 — это места #2–3), поэтому позиция считается один раз. Запрос, по которому в выдаче три сайта проекта, считается трижды.",
      againstCheck: "Изменение — к предыдущей проверке каждого запроса.",
      noCheck: "Раньше эти запросы не проверялись, сравнивать не с чем.",
      againstPeriod: (since: string) => `Изменение — к предыдущему периоду (${since}).`,
      noPeriod: "В предыдущем периоде проверок не было, сравнивать не с чем.",
      beforeCheck: (n: number) => `При предыдущих проверках: ${n}`,
      dropped: "Выпавшие запросы",
      droppedAbout:
        "Сколько запросов, по которым URL проекта стоял в этой полосе мест, а теперь этого URL в выдаче нет совсем; если URL просто опустился ниже, он не считается. Каждый столбец — своя полоса (Топ 3 — это места #2–3), поэтому URL считается один раз — там, где он был. «Нет в выдаче» — на той глубине, до которой проверка её снимает. Наведите на число, чтобы увидеть запросы и URL.",
      band: (from: number, to: number) => (from === to ? `#${to}` : `#${from}–${to}`),
      droppedLine: (keyword: string, url: string, was: number) => `${keyword} — ${url} (был #${was})`,
      droppedAgainstCheck: "К предыдущей проверке каждого запроса.",
      droppedAgainstPeriod: (since: string) => `К предыдущему периоду (${since}).`,
      droppedNone: "Ни один из этих запросов не с чем сравнить.",
      droppedList: (keywords: string[], more: number) => keywords.join("\n") + (more > 0 ? `\n… и ещё ${more}` : ""),
      serpCol: "Поисковик · GEO",
      keywordsCol: "Запросов",
      top: (n: number) => `Топ ${n}`,
      beyondDepth: (depth: number) => `Проверки этой выдачи доходят только до ${depth} позиции, дальше этот столбец считать не может.`,
      before: (n: number) => `В предыдущем периоде: ${n}`,
      filters: "Фильтры",
      engine: "Поисковик",
      geo: "GEO",
      position: "Позиция",
      change: "Изменение",
      compare: "Сравнить с",
      compareCheck: "предыдущей проверкой",
      compareCheckHint: "Проверка запроса перед последней — даже если она была до начала периода.",
      comparePeriod: "предыдущим периодом",
      comparePeriodHint: (since: string) => `Последняя проверка запроса в предыдущем периоде (${since}).`,
      all: "Все",
      changeKinds: { up: "Выросли", down: "Упали", same: "Без изменений", new: "Новые", lost: "Выпали", none: "Нет сравнения" } as Record<string, string>,
      search: "Найти запрос или URL…",
      col: { keyword: "Запрос", cluster: "Кластер", geo: "GEO", engine: "Поисковик", position: "Последняя", best: "Лучшая", average: "Средняя", trend: "Динамика", change: "Изменение" },
      export: "Экспорт CSV",
      exportHint: "Скачать всю таблицу в CSV — все URL, независимо от фильтров выше, в порядке таблицы",
      exportOptions: "Настроить экспорт",
      exportGeoEngine: "GEO и поисковик",
      exportPosition: "Позиция (последняя)",
      exportBand: (n: number, from: number) => (from === n ? `Топ ${n} (#${n})` : `Топ ${n} (#${from}–${n})`),
      exportNone: "Нет в выдаче",
      exportChange: "Изменение",
      exportCompare: (what: string) => `Изменение — по сравнению с ${what}, как в таблице.`,
      exportCount: (n: number) => `Будет выгружено URL: ${n}`,
      exportDownload: "Скачать CSV",
      exportReset: "Выбрать всё",
      exportClear: "Очистить всё",
      noCluster: "Без кластера",
      findIn: "Найти…",
      groupAll: "Все",
      groupNone: "Ни одного",
      picked: (n: number) => `Выбрано: ${n}`,
      csvHead: ["Запрос", "URL", "Домен", "GEO", "Поисковик", "Последняя", "Лучшая", "Средняя", "Изменение", "Было", "Что изменилось"],
      changeRow: { up: "выросла", down: "упала", same: "без изменений", new: "новый", lost: "выпал", none: "нет сравнения" } as Record<string, string>,
      columns: "Столбцы",
      columnsHint: "Выбрать, какие столбцы показывать в таблице",
      columnsAll: "Показать все",
      positionHint: "По последней проверке запроса за период. — : URL не было в той выдаче.",
      bestHint: "Лучшая позиция за проверки периода — и за проверку, с которой сравнивается изменение, если она была до начала периода: так лучшая, средняя и изменение охватывают одно и то же время.",
      averageHint: "Среднее по тем же проверкам, что и лучшая, — тем, в которых URL был в выдаче; проверки, где его не было, позицией не считаются.",
      rankedIn: (ranked: number, checks: number) => `в выдаче в ${ranked} из ${checks} ${pluralRu(checks, ["проверки", "проверок", "проверок"])}`,
      trendTitle: (points: string) => `Позиция по проверкам: ${points}`,
      new: "новый",
      lost: (was: number) => `выпал (был #${was})`,
      was: (was: number) => `был #${was}`,
      shown: (n: number, total: number) => `${n} из ${total} URL`,
      more: (n: number) => `Показать ещё ${n}`,
      empty: "За этот период ни один URL проекта не был в выдаче.",
      emptyFilter: "Под эти фильтры не подходит ни один URL.",
      ampOf: (site: string) => `AMP для ${site}`,
    },
    fromRuns: (runs: number, rows: number, serps: number) =>
      `замеров: ${rows} по выдачам: ${serps}, прогонов за период: ${runs}`,
    colKeyword: "Запрос",
    colOurPositions: "Наши позиции",
    colShare: "Монополизация",
    colChecked: "Проверено",
    shareWhat:
      "Какую часть этой страницы выдачи занимают домены проекта вместе. 100% — это вся страница.\n\n" +
      "Учитываются все занятые ими позиции, и каждая — со своим весом. Поэтому это не просто доля занятых строк, и список позиций слева нельзя сложить на глаз.\n\n" +
      "Сколько стоит позиция, задаётся в «Настройки → Мониторинг выдачи → Веса видимости». Если прогон снял меньше результатов, чем позиций в кривой, те же 100% делятся между теми, что есть.",
    shareSlots: (held: number, total: number) =>
      `${held} из ${total} ${pluralRu(total, ["позиции", "позиций", "позиций"])}`,
    shareHint: (held: number, total: number) =>
      `Проект занимает ${held} из ${total} результатов, снятых этим прогоном. Каждая из этих позиций считается по своему весу, а не как одна строка, — поэтому здесь процент, а не ${held}/${total}.`,
    slotsHint: (held: number, total: number) =>
      `${held} из ${total} результатов, снятых этим прогоном, принадлежат доменам проекта. Это исходный счёт, стоящий за процентом выше, где те же позиции взвешены по их месту на странице.`,
    shortPageHint: (total: number) =>
      `⚠ Этот прогон снял всего ${total} ${pluralRu(total, ["результат", "результата", "результатов"])}, поэтому вес недостающих позиций распределён между теми, что есть, и все показатели в этой строке считаются от меньшей страницы. Так выглядит и по-настоящему короткая выдача, и неполное снятие — различить их позволяет именно количество.`,
    multiSlot: (n: number) => `Позиций: ${n}`,
    multiSlotHint: (positions: string, share: number) =>
      `Этот домен занимает на странице позиции ${positions} — вместе это ${share}% страницы. В плашке показана лучшая из них, но в монополизацию входят все.`,
    serpShare: (share: string) => `Монополизация ${share}`,
    serpShareHint:
      "Среднее по запросам этой выдачи: на типичном запросе столько страницы принадлежит доменам проекта. Каждый запрос — это своя страница, поэтому значения усредняются, а не складываются. Берётся последний прогон каждого запроса внутри периода.",
    showRaw: (n: number) => `Показать хост, на который ведёт ссылка (отличается: ${n})`,
    serpCount: (n: number) => `выдач: ${n}`,
    substituted: "показан под другим хостом",
    substitutedHint: (shown: string, linked: string) =>
      `Показан как ${shown}, ведёт на ${linked}`,
    unresolvedHint:
      "Задача приводит к показанному сайту, но поисковик его не сообщил для этого результата — ниже исходная ссылка.",
    ampOfSite: "AMP-домен сайта",
    ampAvgHint: (site: string, hosts: string) =>
      `Результаты на AMP-доменах сайта ${site} — одной строкой, потому что AMP-домен меняется каждый день. За период они были на: ${hosts}.`,
    ampMore: (n: number) => `и ещё ${n}`,
    ampSince: (day: string) => `с ${day}`,
    ampBefore: (day: string) => `до ${day}`,
    ampConfigHint: (site: string, period: string) =>
      `Из AMP-конфига ротатора: прежний AMP-домен сайта ${site}, был в работе ${period} — до того, как SERP Monitor начал проверку. Точные даты неизвестны.`,
    ampPeriodHint: (site: string, period: string) =>
      `AMP-домен сайта ${site}: ${period}. Это дни, когда AMP Rotator называл его в ответах SERP Monitor. Ротатор сообщает, какой AMP-домен текущий, но не с какого времени, — поэтому AMP-доменом он мог быть и раньше первого из этих дней.`,

    notRanking: "нет в снятых результатах",
    ranking: (ranking: number, total: number) =>
      `ранжируется по ${ranking} из ${total} запросов`,
    footnote: "В каждой строке — последний прогон внутри периода: перечислены все домены проекта, которые ранжируются, начиная с лучшей позиции. «Монополизация» — какую часть этой страницы занимает проект всеми своими доменами, с учётом веса каждой позиции. Если у запроса ничего не указано, ни одного домена проекта не было среди снятых позиций этого прогона, а это не то же самое, что «не ранжируется вовсе». Результат на AMP-домене, который назвал AMP Rotator проекта, тоже считается результатом проекта и отмечен «AMP».",

    view: "Вид",
    viewLatest: "Последние",
    viewLatestHint: "Где запрос стоит сейчас: последний прогон внутри периода.",
    viewAverage: "Средние",
    viewAverageHint: "Все прогоны периода, усреднённые по запросу и домену.",
    avgFootnote: "По строке на каждую пару «запрос — домен», по всем прогонам этой выдачи за период, отсортировано по видимости. В среднюю позицию входят только те прогоны, где домен действительно присутствовал: у отсутствия нет позиции, которую можно усреднить, поэтому присутствие показано отдельной величиной. Видимость объединяет то и другое: это доля страницы, которую занимал домен, усреднённая по всем прогонам, включая те, где его не было. Лучшая и худшая позиции ограничивают среднее: большой разброс на нескольких прогонах — это слабое измерение, а не позиция. AMP-домены одного сайта — одна строка с пометкой «AMP»: сам домен меняется каждый день.",
    visibilityWhat:
      "Доля страницы, которую занимал этот домен, усреднённая по всем прогонам за период — включая те, где его вообще не было: они считаются нулём.\n\n" +
      "Позиция и присутствие в одном числе: домен, который ранжируется редко, но высоко, и домен, который есть всегда, но ниже, попадают на одну шкалу. Кто из них окажется выше, зависит от весов.\n\n" +
      "Сколько стоит позиция, задаётся в «Настройки → Мониторинг выдачи → Веса видимости».",
    visibilityHint: (share: number, ranked: number, runs: number) =>
      `${share}% этой страницы — среднее по всем прогонам (${runs}); те, где домена не было, считаются нулём. Присутствует в ${ranked} из них. Каждая позиция стоит долю страницы, которая задаётся в настройках, а если результатов меньше, та же сумма делится между теми позициями, что есть.`,
    projectShare: (share: string) => `${share} этой страницы`,
    projectShareHint:
      "Сколько проект занимает на этой странице всеми своими доменами. Доли — это части одной страницы, поэтому они складываются: занять все позиции — ровно 100%.",
    colDomain: "Домен",
    colVisibility: "Видимость",
    colAvgPosition: "Средняя позиция",
    colSpread: "Лучшая – худшая",
    colPresent: "Присутствие",
    colAbsent: "Отсутствие",
    colRuns: "Прогонов",
    fromRunsAvg: (runs: number, rows: number, serps: number) =>
      `Строк: ${rows} по ${serps} выдачам, среднее по ${runs} ${pluralRu(runs, ["прогону", "прогонам", "прогонам"])} за период`,
    serpRuns: (n: number) =>
      `${n} ${pluralRu(n, ["прогон", "прогона", "прогонов"])} за период`,
    presentHint: (ranked: number, runs: number) =>
      `Есть в результатах в ${ranked} из ${runs} ${pluralRu(runs, ["прогона", "прогонов", "прогонов"])}`,
    absentHint: (missed: number, runs: number) =>
      `Нет в снятых результатах в ${missed} из ${runs} ${pluralRu(runs, ["прогона", "прогонов", "прогонов"])}`,
    avgHint: (ranked: number, runs: number) =>
      `Среднее по ${ranked} ${pluralRu(ranked, ["прогону", "прогонам", "прогонам"])}, где домен ранжировался, из ${runs} снятых`,
    neverRanked: (runs: number) =>
      `Нет в снятых результатах ни в одном из ${runs} ${pluralRu(runs, ["прогона", "прогонов", "прогонов"])}`,
    substitutedIn: (n: number, runs: number) =>
      `Засчитано показанному хосту в ${n} из ${runs} ${pluralRu(runs, ["прогона", "прогонов", "прогонов"])}`,
    unknownProvider: "Среднее по прогонам с неизвестным провайдером",
    unknownProviderHint: (n: number, runs: number) =>
      `У ${n} из ${runs} ${pluralRu(runs, ["прогона", "прогонов", "прогонов"])} в этом среднем провайдер не записан — такие прогоны сделаны до того, как это стало сохраняться. Провайдеры нумеруют выдачу по-разному, так что среднее может смешивать две шкалы и не может это показать.`,
    mixedProviders: "Среднее по разным провайдерам",
    mixedProvidersHint: (providers: string) =>
      `Прогоны сняты через ${providers}, а они нумеруют выдачу по-разному: DataForSEO учитывает рекламу и AI-блоки в номере позиции, SerpAPI — нет. Среднее смешивает две шкалы, поэтому считайте его приблизительным и сравнивайте однородные данные.`,
    noAverages: "За этот период нечего усреднять. Запустите задачу проекта или расширьте период.",
    noDomains: "У проекта пока нет доменов. Добавьте их в настройках проекта — и здесь появятся позиции.",
    noRuns: "За этот период прогонов не было. Запустите задачу проекта или расширьте период.",
    geos: "Локации",
    engines: "Поисковики",
    noGeo: "без гео",
    scheduled: "Задачи по расписанию",
    manualJobs: (n: number) => `Ещё задач в проекте, запускаемых вручную: ${n}.`,
    keywords: "Отслеживаемые запросы",
    noKeywords: "Запросов пока нет — они берутся из задач проекта.",
    exportButton: "Экспорт CSV",
    exportSites: "Сайты в файле",
    exportAll: "Вся страница",
    exportAllHint: "Все сайты на каждой позиции, наши отмечены ★: видно, кто занимает остальные места.",
    exportOurs: "Только наши",
    exportOursHint: "Только сайты проекта — как в таблицах.",
    exportGrid: "CSV · таблица",
    exportGridHint:
      "Строка на запрос; в колонках 1, 2, 3… — сайт на этой позиции. Удобнее всего читать. " +
      "Те же строки, что на экране: последний прогон каждого запроса за период.",
    exportList: "CSV · список",
    exportListHint:
      "Строка на позицию: запрос, позиция, сайт, наш или нет, URL, заголовок. Для фильтров и сводных таблиц. " +
      "Те же строки, что на экране: последний прогон каждого запроса за период.",
  },
  jobForm: {
    mode: "Режим",
    modeSerp: "1 · Мониторинг выдачи",
    modeSerpHelp: "Снимать выдачу и смотреть распределение доменов / URL.",
    modeAnalyzer: "2 · Анализатор выдачи",
    modeAnalyzerHelp:
      "Снять выдачу, затем получить метрики Ahrefs для каждого URL и показать сложность ранжирования по каждому ключевому слову.",
    modeCompare: "3 · Сравнение SERP API",
    modeCompareHelp:
      "Отправить одни и те же запросы через несколько провайдеров и сравнить домены, URL и количество результатов бок о бок.",
    compareProviders: "Провайдеры для сравнения",
    compareProvidersHelp:
      "Каждый запрос уходит к каждому выбранному провайдеру, и каждый провайдер берёт плату за свои запросы — оценка ниже их суммирует.",
    compareNeedTwo: "Выберите минимум двух провайдеров для сравнения.",
    compareYandexGap: (names: string) =>
      `${names} не умеет работать с Яндексом. Эти ячейки будут помечены «не поддерживается» — такие запросы не отправляются, не оплачиваются и не считаются расхождениями.`,
    estimateByProvider: "По провайдерам",
    ahrefsMetrics: "Метрики Ahrefs",
    ahrefsMetricsHelp:
      "Какие метрики запрашивать для каждого URL из выдачи. Анализ идёт в режиме точного URL, поэтому UR считается по странице, а не по домену.",
    whois: "Возраст домена (WHOIS)",
    whoisHelp:
      "Узнать дату регистрации каждого домена и передать возраст в AI. Сайт с сотнями ссылающихся доменов и без ключей в топ-10 читается совершенно по-разному в полгода и в десять лет.",
    whoisCost:
      "Сначала спрашивается RDAP — бесплатно; DataForSEO WHOIS — только для доменов, на которые RDAP не отвечает (в основном национальные зоны: .kz, .ru, .by, .uz). DataForSEO берёт плату за запрос (~$0,12), а не за домен. Ответы хранятся в кэше 180 дней, «не найден» — 14 дней.",
    whoisNoCreds:
      "⚠ Доступы DataForSEO не заданы — у доменов, на которые не отвечает RDAP (в основном национальные зоны), возраста не будет. На остальной прогон это не влияет. Добавьте доступы в «Настройки → Мониторинг выдачи → DataForSEO».",
    ahrefsCacheTitle: "Кэш метрик",
    ahrefsCacheHelp:
      "Сколько времени метрика Ahrefs переиспользуется между запусками вместо повторной покупки. В отличие от даты регистрации домена, DR и число ссылок меняются — слишком большой TTL означает, что запуск покажет значения, которые он не измерял. 0 отключает кэш.",
    ahrefsCacheTtl: "Переиспользовать метрики",
    ahrefsCacheDays: "дней",
    ahrefsCacheOff: "Кэш отключён — каждый запуск покупает все метрики заново.",
    ahrefsCacheClear: "Очистить кэш",
    ahrefsCacheCleared: (n: number) => `Очищено записей: ${n}.`,
    ahrefsNoKey:
      "⚠ API-ключ Ahrefs не задан — запуски в режиме анализатора завершатся ошибкой. Добавьте ключ в «Настройки → Анализатор выдачи → Ahrefs».",
    ahrefsUnitsEstimate: (urls: number, perUrl: number, units: number) =>
      `≈ ${urls.toLocaleString()} URL × ${perUrl} юнитов каждый ≈ ${units.toLocaleString()} юнитов Ahrefs за прогон. Это верхняя оценка — дубликаты URL запрашиваются один раз, а кэшированные ответы стоят дешевле.`,
    ahrefsDomainMetrics: "Метрики уровня домена",
    ahrefsDomainMetricsHelp:
      "Запрашиваются отдельно, в режиме домена. Именно это отличает слабую страницу на СИЛЬНОМ сайте от слабой страницы на слабом сайте — по метрикам страницы такое не определить. Домены дедуплицируются гораздо сильнее URL, поэтому это заметно дешевле основного прохода.",
    ahrefsDomainOff: "Ничего не выбрано — обогащение по доменам для этой задачи выключено.",
    ahrefsDomainUnits: (perDomain: number, units: number, combined: number) =>
      `Плюс домены по ${perDomain} юнитов ≈ ${units.toLocaleString()} юнитов — итого около ${combined.toLocaleString()}.`,
    ahrefsUnderFloor: (base: number) =>
      `Любой запрос стоит минимум ${base} юнитов, а этот прогон в этот минимум укладывается — дополнительные метрики здесь фактически бесплатны.`,
    name: "Название",
    namePlaceholder: "напр. Мониторинг бренда — KZ/RU",
    keywords: "Ключевые слова",
    preferShownHost: "Приводить AMP и CDN к показанному сайту",
    preferShownHostHelp:
      "AMP- или CDN-результат ведёт на технический хост, а поисковик печатает издателя — by.tribuna.com над ссылкой на cloudfront.net. С этой опцией ранжируется показанный сайт. Исходные хосты всегда сохраняются и доступны в один клик.",
    preferShownHostWarn:
      "Это то же поле, которое подделывает дорвей: результат, печатающий чужой бренд, будет засчитан этому бренду. Подменённые результаты помечены ⇄, чтобы было видно, что изменилось.",
    project: "Проект",
    noProject: "— без проекта —",
    projectHint: "Задачи с проектом группируются в его папке в списке задач.",
    projectNoneYet: "Проектов пока нет — создайте проект на странице «Проекты», чтобы группировать задачи.",
    keywordsHint: "(по одному на строку, не более 1000)",
    keywordsOverflow: (dropped: number, max: number) =>
      `${dropped} строк(и) сверх лимита в ${max} ключей не будут сохранены — сократите список перед сохранением.`,
    keywordsPlaceholder: "acme вход\nacme отзывы\nacme скачать",
    keywordsCount: (n: number) =>
      `${n} ${pluralRu(n, ["ключевое слово", "ключевых слова", "ключевых слов"])}`,
    provider: "Провайдер",
    providerHelpPrefix: "Сначала укажите учётные данные провайдеров в разделе ",
    providerHelpLink: "Настройки",
    providerHelpSuffix:
      ". Провайдеры немного отличаются: у каждого своя база локаций, и при выбранном провайдере поиск в форме задачи идёт по его полной базе — SerpAPI: собственная; DataForSEO: собственная (запрос по ID локации); Bright Data и Oxylabs: список гео-таргетов Google. Один и тот же город может называться в них по-разному, поэтому локации сопоставляются по ID Google, а не по названию. Для Яндекса Bright Data и Oxylabs учитывают только страну / yandex_lr.",
    dataforseoNeedsLanguage:
      "⚠ DataForSEO требует язык для каждого запроса — в отличие от Google, у него нет значения по умолчанию, и без языка запрос отклоняется. Выберите язык (для Казахстана обычно ru), иначе его запросы завершатся ошибкой.",
    dataforseoNoYandex:
      "⚠ У DataForSEO нет эндпоинта для Яндекса — их SERP API поддерживает только Google, Bing, Yahoo, Baidu, Naver и Seznam. Запросы к Яндексу в этой задаче завершатся ошибкой. Используйте SerpAPI, Bright Data или Oxylabs для Яндекса, либо уберите Яндекс из поисковиков и оставьте DataForSEO для Google.",
    engines: "Поисковики",
    enginesPlaceholder: "Выберите поисковики…",
    devices: "Устройства",
    devicesPlaceholder: "Выберите устройства…",
    locations: "Геолокации (страны / регионы / города)",
    locationsPlaceholder: "Выберите из сохранённых или найдите…",
    locationsOnly: (providers: string) =>
      `В списке только локации, которые поддерживает ${providers}. У каждого провайдера своя база локаций, и один и тот же город может называться в них по-разному.`,
    locationUnsupported: (loc: string, providers: string) =>
      `${providers} не поддерживает локацию «${loc}»: её нет в базе локаций этого провайдера. Удалите её и выберите место заново из списка.`,
    locationCountryOnly: (loc: string, providers: string) =>
      `Локации «${loc}» нет в списке гео-таргетов Google, по которому работает ${providers}: Google её проигнорирует, и поиск пойдёт по всей стране. Чтобы получить выдачу по городу, выберите место заново из списка.`,
    languages: "Языки",
    languagesPlaceholder: "Выберите языки…",
    googleDomains: "Домены Google (необязательно)",
    googleDomainsPlaceholder: "Если пусто — берётся из страны",
    topN: "Топ N позиций",
    schedule: "Расписание",
    cronHelpPrefix: (tz: string) => (
      <>
        Cron-выражение в часовом поясе <strong>{tz}</strong>. Напр.{" "}
        <code>0 */6 * * *</code> = каждые 6 часов.
      </>
    ),
    cronEditHint: (
      <>
        {" "}Чтобы изменить, отредактируйте <code>scheduler.py</code> и пересоберите api (<code>docker compose up -d --build api</code>).
      </>
    ),
    enabled: "Включено",
    cronPlaceholder: "0 */6 * * *",
    cronPresets: {
      hourly: "Каждый час",
      every6h: "Каждые 6 ч",
      daily06: "Ежедневно 06:00",
      daily09And21: "Ежедневно 09:00 + 21:00",
      weekdays08: "Будни 08:00",
    },
    estimateTitle: "Расчётное число запросов за прогон",
    estimateBreakdown: (g: number, y: number) => `Google: ${g} · Yandex: ${y}`,
    estimateApprox:
      "(Приблизительно — бэкенд удаляет дубликаты вариантов.)",
    estimateCostTitle: "Расчётная стоимость прогона",
    estimateRate: (rate: string) => `по ${rate} за запрос`,
    estimateEditRate: "изменить ставку",
    estimateDepthNote: (provider: string, units: number, topN: number) =>
      provider === "brightdata"
        ? `⚠ Bright Data отдаёт одну страницу Google (~10 результатов) за запрос — Топ N ${topN} занимает до ${units} запросов на поиск в Google (цена ×${units}). Поставьте Топ N = 10, чтобы платить базовую ставку.`
        : `⚠ DataForSEO тарифицирует за каждые 10 результатов — Топ N ${topN} считается как ${units} SERP на запрос (цена ×${units}). Поставьте Топ N = 10, чтобы платить базовую ставку.`,
    saveCreate: "Создать задачу",
    saveChanges: "Сохранить изменения",
    saveAndRunCreate: "Создать и запустить",
    saveAndRunUpdate: "Сохранить и запустить",
    engineOptions: { google: "Google", yandex: "Yandex" },
    deviceOptions: { desktop: "Десктоп", mobile: "Мобильный" },
    targeting: {
      noLocations:
        "Локации не выбраны — запросы будут выполняться без гео-таргетинга (или со страной по умолчанию, если задан домен Google).",
      header: (provider: string) => (
        <>
          Фактический таргетинг · провайдер:{" "}
          <span className="text-neutral-800 dark:text-neutral-200">{provider}</span>
        </>
      ),
      noEngines: "Поисковики не выбраны.",
      noLrWarning: (
        <>
          ⚠ Для этой локации не задан <code>yandex_lr</code> — Яндекс будет
          использовать только домен страны. Добавьте ID региона Яндекса в
          разделе «Настройки» для этой локации.
        </>
      ),
      gran: { city: "город", country: "страна", none: "без гео" },
      engineGoogle: "Google",
      engineYandex: "Яндекс",
    },
  },
  run: {
    title: (id: number) => `Запуск №${id}`,
    headerStats: (done: number, total: number) =>
      `${done}/${total} ${pluralRu(total, ["запрос", "запроса", "запросов"])}`,
    failed: (n: number) =>
      `${n} ${pluralRu(n, ["ошибка", "ошибки", "ошибок"])}`,
    exportTop: "Экспортировать топ",
    downloadCsv: "Скачать CSV",
    filterPlaceholder: "Фильтр по ключевому слову…",
    missingQueries: (missing: number, total: number) =>
      `${missing} из ${total} запросов не вернули результатов.`,
    missingHint:
      "У этих ключей нет выдачи, а значит нет ни метрик, ни возраста доменов, ни вердикта AI. Повтор отправит только недостающие запросы — остальная часть прогона не пересобирается и не оплачивается заново.",
    retryQueries: (n: number) => `Повторить: ${n}`,
    retrying: "Повторяем…",
    phases: {
      scrape: "Сбор выдачи",
      ahrefs: "Метрики Ahrefs",
      whois: "Возраст доменов",
      ai: "Вердикты AI",
    } as Record<string, string>,
    phaseFailed: (n: number) => `ошибок: ${n}`,
    phaseHint:
      "Ahrefs и проверка возраста доменов ничего не пишут в таблицу, пока не закончат, поэтому на исправном прогоне таблица может минутами стоять на месте. Затем вердикты приходят по одному запросу.",
    stoppedDuring: (phase: string) => `Остановился на этапе: ${phase}`,
    verify: {
      title: "Проверить выполненные запросы",
      summary: (n: number) =>
        `(${n} ${pluralRu(n, ["уникальный запрос", "уникальных запроса", "уникальных запросов"])} — кликните по URL, чтобы увидеть, что показал бы Google / Яндекс)`,
      footer: (
        <>
          Это те же URL, которые принимают сами поисковые системы — параметры
          провайдера (<code>brd_json</code>, <code>parse</code>,{" "}
          <code>source</code> и т. п.) удалены, поэтому в браузере вы увидите
          ровно то, что мы запрашивали у Google/Яндекса.{" "}
          <strong>Мобильные варианты</strong> в URL выглядят так же, как
          десктопные, у обоих поисковиков — мобильная выдача определяется
          User-Agent. Используйте инструменты разработчика Chrome
          (Ctrl+Shift+M), чтобы переключить User-Agent для проверки мобильного
          скрапа на живой выдаче.
        </>
      ),
    },
    groupCount: (results: number, variants: number) =>
      `${results} ${pluralRu(results, ["результат", "результата", "результатов"])} · ${variants} ${pluralRu(variants, ["вариант", "варианта", "вариантов"])}`,
    streaming: "Результаты поступают…",
    noResults: "Результатов нет.",
    overview: {
      title: "Обзор",
      hint: "Распределение доменов и URL по всем запросам этого прогона.",
      engineGoogle: "Google",
      engineYandex: "Яндекс",
      engineSummary: (n: number) =>
        `${n} ${pluralRu(n, ["строка результата", "строки результата", "строк результата"])}`,
      domainsTitle: "Домены",
      urlsTitle: "URL",
      colDomain: "Домен",
      colUrl: "URL",
      colCount: "Кол-во",
      colAvgPos: "Ср. поз.",
      noneForEngine: "Нет строк по этому поисковику.",
      fullBreakdown: "Полный разбор →",
    },
  },
  overviewPage: {
    title: (id: number) => `Обзор — Запуск №${id}`,
    back: "← Назад к запуску",
    groupBy: "Группировать по",
    dimEngine: "Поисковик",
    dimGeo: "Гео",
    dimLanguage: "Язык",
    dimDevice: "Устройство",
    combinations: (n: number) =>
      `${n} ${pluralRu(n, ["комбинация", "комбинации", "комбинаций"])}`,
    allResults: "Все результаты",
    rowsInGroup: (n: number) =>
      `${n} ${pluralRu(n, ["строка", "строки", "строк"])}`,
    empty: "В этом запуске пока нет результатов.",
  },
  variantLabel: {
    google: "Google",
    yandex: "Яндекс",
    desktop: "Десктоп",
    mobile: "Мобильный",
    country: "страна",
    noGeo: "без гео",
  },
  clusters: {
    title: "Кластеры",
    help: "Все кластеры запросов проекта и каждый запрос с его кластером. Кластер можно переименовать или снять со всех его запросов, запросу — сменить кластер, а многим сразу — задать списком. Ничего не меняется до «Сохранить». Сами запросы добавляются и удаляются на странице проекта.",
    open: "Кластеры",
    clustersTitle: "Кластеры",
    noClusters: "В проекте пока нет кластеров: задайте их запросам ниже или добавьте запросы с кластером на странице проекта.",
    cluster: "Кластер",
    keywords: "Запросов",
    keyword: "Запрос",
    none: "Без кластера",
    show: "Показать",
    showHint: (name: string) => `Показать запросы кластера «${name}»`,
    rename: "Переименовать",
    cancel: "Отмена",
    remove: "Удалить",
    removeConfirm: (name: string, n: number) => `Снять кластер «${name}» с его запросов (${n})? Сами запросы останутся.`,
    keywordsTitle: "Запросы",
    search: "Найти запрос или кластер…",
    allClusters: "Все кластеры",
    findCluster: "Найти кластер…",
    bulk: "Задать списком",
    bulkHint: "По одному в строке: запрос проекта и его кластер после табуляции, «;» или «,». Пустой кластер снимает кластер. Запросы, которых нет в проекте, пропускаются.",
    bulkPlaceholder: "казино онлайн, Бренд\nслоты; Игры",
    bulkApply: "Применить",
    bulkDone: (set: number, unknown: number) =>
      `Задано: ${set}.` + (unknown ? ` Нет в проекте, пропущено: ${unknown} — сначала добавьте их на странице проекта.` : "") + " Нажмите «Сохранить», чтобы применить.",
    changes: (n: number) => `К сохранению изменений: ${n}`,
    undo: "Отменить изменения",
    noKeywords: "В проекте пока нет запросов.",
    nothingFound: "Ничего не найдено.",
    shown: (n: number, total: number) => `${n} из ${total}`,
    more: "Показать ещё",
  },
  projectKeywords: {
    placeholder: "Найти или добавить запрос…",
    add: "Добавить",
    clearAll: "Очистить все",
    removeOne: (k: string) => `Убрать «${k}»`,
    pending: (removed: number, added: number, clusters: number) =>
      `Будет удалено: ${removed} · добавлено: ${added}` + (clusters ? ` · кластеров изменится: ${clusters}` : ""),
    bulk: "Добавить списком",
    bulkHint: "Один запрос в строке. Кластер — после табуляции, «;» или «,»: «запрос, кластер». Запросу, который уже есть в проекте, только задаётся кластер.",
    bulkPlaceholder: "казино онлайн\nслоты, Игры\nбонус; Акции",
    bulkAdd: "Добавить",
    csvUpload: "Загрузить CSV",
    csvHint: "CSV: запрос в первом столбце, кластер во втором — или там, где их назовёт строка заголовка (Запрос, Кластер).",
    staged: (keywords: number, clusters: number) =>
      `К сохранению: новых запросов — ${keywords}, кластеров — ${clusters}. Нажмите «Сохранить» ниже, чтобы применить.`,
    nothingRead: "Не удалось прочитать ни одного запроса.",
    undo: "Отменить",
    empty: "Запросов нет.",
    nothingFound: "Ничего не найдено. Enter — добавить этот запрос.",
    confirm: (n: number) => `Удалить из проекта запросов: ${n}? Задачи проекта перестанут их проверять.`,
  },
  serpCsv: {
    button: "Загрузить CSV",
    title: "Загрузить выдачу из CSV",
    help:
      "Файл из внутреннего инструмента проверки выдачи. Читаются четыре столбца — Keywords, GEO, Domain / URL, Position; все остальные игнорируются. Загрузка сохраняется как прогон этого проекта: позиции, блокировки и отправка в Proxy Checker работают с ней как с любым другим прогоном.",
    file: "Файл",
    engine: "Поисковик",
    device: "Устройство",
    day: "День проверки",
    fieldsHint:
      "В файле не сказано, в каком поисковике и на каком устройстве шла проверка, поэтому укажите их здесь. День берётся из имени файла, если он там есть.",
    upload: "Загрузить",
    uploading: "Загружаю…",
    showPositions: "Показать позиции",
    barTitle: (rows: number, queries: number) =>
      `Загружено ${rows} ${pluralRu(rows, ["позиция", "позиции", "позиций"])} по ${queries} ${pluralRu(queries, ["запросу", "запросам", "запросам"])}`,
    barDay: (day: string) => `за ${day}`,
    barEmpty: (n: number) => `без результата («–»): ${n}`,
    barGeosAdded: (list: string) => `в GEO проекта добавлено: ${list}`,
    barProxyChecker: "отправляется в Proxy Checker",
    barNotLoaded: (n: number) => `не загружено строк: ${n}`,
    barRun: (id: number) => `Прогон №${id}`,
    dismiss: "Скрыть",
    log: {
      title: "Загрузки CSV",
      help: "Все выгрузки выдачи, загруженные в этот проект, новые сверху. Удаление загрузки убирает её позиции со вкладок «Позиции» и «Блокировки»; запросы и GEO, которые она добавила в проект, остаются.",
      empty: "Пока ничего не загружено. Кнопка «Загрузить CSV» — вверху страницы.",
      col: {
        uploaded: "Загружено", file: "Файл", day: "За день", serp: "Поисковик · устройство", rows: "Позиций / запросов",
        geos: "Страны", skipped: "Пропущено", actions: "Действия",
      },
      rowsQueries: (rows: number, queries: number) => `${rows} / ${queries}`,
      geosAdded: (list: string) => `добавлено в GEO: ${list}`,
      empty_: (n: number) => `без результата («–»): ${n}`,
      notLoaded: (n: number) => `не загружено строк: ${n}`,
      bad: (n: number) => `не прочитано: ${n}`,
      none: "нет",
      notKept: "Не записывалось для загрузок до 14.10.2026",
      notSent: "не отправлялось",
      accepted: (ok: number, all: number) => `принято ${ok} из ${all}`,
      noAnswer: (n: number) => `нет ответа: ${n}`,
      refused: (n: number) => `отклонено: ${n}`,
      runName: (id: number) => `Прогон №${id}`,
      delete: "Удалить",
      deleting: "Удаляю…",
      deleteConfirm: (what: string, day: string, rows: number) =>
        `Удалить загрузку «${what}» за ${day} и её позиции (${rows})? Запросы и GEO, которые она добавила, останутся в проекте.`,
    },
    failTitle: "Файл не загружен",
    skippedEmpty: (n: number) => `Позиций без результата («–»): ${n} — пропущены.`,
    skippedGeo: (list: string) => `Строки пропущены, потому что страна не распознана: ${list}.`,
    skippedBad: (n: number) => `Строк, которые не удалось прочитать: ${n}.`,
    line: "строка",
  },
  tools: {
    proxyChecker: {
      title: "Proxy Checker",
      help:
        "Получает домены ваших проектов, найденные в выдаче при проверках, — по одному запросу на страну, чтобы проверить их из этой страны. Здесь задаётся только подключение: КОГДА проект отправляет, что будет отправлено и что уже отправлено — на странице самого проекта, на вкладке «Блокировки».",
      url: "Адрес API",
      urlPlaceholder: "https://…/api/daily-check",
      token: "Токен",
      tokenPlaceholder: "Bearer-токен",
      wait: "Ждать ответа",
      waitUnit: "мин",
      waitHint: (lo: number, hi: number) =>
        `Proxy Checker проверяет домены через свои прокси, прежде чем ответить, поэтому запрос с большим числом доменов идёт дольше. Если за это время ответа нет, отправка записывается как «нет ответа». От ${lo} до ${hi} мин. Кнопка «Отправить сейчас» на странице проекта ждёт столько же на каждую страну.`,
      waitBad: (lo: number, hi: number) => `Время ожидания — целое число минут от ${lo} до ${hi}.`,
      connected: "подключён",
      notConnected: "не подключён",
      noTest:
        "Отдельной «проверки» нет: у API только один запрос, поэтому токен проверяется первой настоящей отправкой — откройте вкладку «Блокировки» проекта, нажмите «Отправить сейчас» и посмотрите ответ там же.",
      projectsTitle: "Когда отправляет каждый проект",
      projectsHelp: "Задаётся на странице самого проекта.",
      projectsEmpty: "Проектов пока нет.",
      mode: {
        off: "Выключено",
        after_run: "После каждого прогона/загрузки CSV",
        daily: (time: string) => `Ежедневно в ${time}`,
      },
      auto: "Автоматически отправлять после каждой проверки выдачи и загрузки CSV",
      autoHint:
        "Если включено, домены проекта уходят в Proxy Checker сразу после каждой проверки выдачи или загрузки CSV. Это действует для всех проектов, кроме тех, у которых на странице проекта выбран свой вариант.",
      logTitle: "Последние отправки",
      logEmpty: "Пока ничего не отправлялось.",
      col: { when: "Отправлено", project: "Проект", geo: "Страна", domains: "Домены", trigger: "Причина", result: "Ответ" },
      trigger: {
        after_run: "после прогона/загрузки", daily: "ежедневно", manual: "вручную",
        direct: "по расписанию, без выдачи", direct_manual: "вручную, без выдачи",
      } as Record<string, string>,
      exchange: {
        show: "curl и ответ",
        hide: "скрыть curl и ответ",
        justSent: "Только что отправлено",
        request: "Запрос (curl)",
        tokenHidden:
          "Запрос в том виде, в каком он был отправлен, одной строкой. Токен в журнал не записывается: чтобы выполнить команду, подставьте свой вместо <token>. Работает как есть в bash и в командной строке Windows (cmd).",
        response: "Необработанный ответ Proxy Checker",
        noResponse: "HTTP-ответа нет: не удалось само соединение",
        notKept:
          "Эта отправка сделана до того, как запросы и полные ответы стали сохраняться. Сохранено только начало ответа:",
        copied: "Скопировано",
      },
      accepted: "принято",
      sendingNow: (trigger: string, geos: string, done: number, requests: number, when: string) =>
        `Идёт отправка в Proxy Checker (${trigger}; ${geos}): готово ${done} из ${requests} ${pluralRu(requests, ["запроса", "запросов", "запросов"])} · начата в ${when}. Она продолжится, даже если закрыть или обновить страницу; каждый ответ сохраняется сразу, как пришёл.`,
      took: (seconds: number) => `${seconds} с`,
      tookHint: "Сколько шёл запрос. Proxy Checker стоит за Cloudflare, который через 120 с обрывает запрос с ошибкой HTTP 524, — поэтому в одном запросе не больше 3 доменов.",
      sendingBusy: "Дождитесь окончания идущей отправки.",
      sendingDone: "Отправка завершена.",
      refused: (code: number | null) => (code ? `отклонено · HTTP ${code}` : "нет ответа"),
    },
    blocks: {
      title: "Домены в выдаче: статус по прокси",
      demoBadge: "демо-данные",
      help:
        "Домены проекта, которые есть в выдаче, по странам, и статус, который каждому из них дал каждый прокси этой страны в Proxy Checker за выбранный период. Сверху — домены, у которых хотя бы один прокси ответил не PASS, начиная с тех, что стоят выше всего.",
      periodHint:
        "Период — это когда ответили прокси: у каждого домена показан их последний ответ внутри периода. Какие домены есть в выдаче, читается за период и неделю до него.",
      demoTitle: "Демо-данные",
      demoText:
        "Ни один прокси ещё не ответил по этим доменам, поэтому прокси и их статусы ниже выдуманы — чтобы показать, как будет выглядеть таблица. Домены, страны и позиции настоящие.",
      demoOff: "Убрать пример",
      noReports:
        "За этот период ничего не проверено: ни один прокси ещё не ответил ни по одному из этих доменов.",
      demoOn: "Показать пример на демо-данных",
      all: "Все",
      allGeos: "Все GEO",
      filterLabel: "Какие домены",
      filter: { not_pass: "Не PASS", pass: "Везде PASS", unchecked: "Не проверены" },
      filterHint: {
        not_pass: "Домены, у которых хотя бы один прокси дал статус не PASS.",
        pass: "Домены, которым все прокси дали PASS.",
        unchecked: "Домены, по которым не ответил ни один прокси.",
      },
      domains: (n: number) => `${n} ${pluralRu(n, ["домен", "домена", "доменов"])} в выдаче`,
      proxies: (n: number) => `${n} прокси`,
      noProxies: "по этой стране ещё не ответил ни один прокси",
      col: {
        domain: "Домен", ampDomain: "AMP-домен", keywords: "Запросов", best: "Лучшая позиция", seen: "Был в выдаче",
        failing: "Не PASS", checked: "Проверен",
      },
      helpAmp:
        "Под таблицей каждой страны — вторая, для AMP-доменов: тех, что сами есть в выдаче этой страны, и сегодняшнего AMP-домена каждого найденного там домена — именно на него попадает посетитель из выдачи.",
      ampOf: (main: string) => `AMP для ${main}`,
      ampInSerps: "сам в выдаче",
      viaMain: "позиция основного домена",
      ampDomains: (n: number) => `${n} ${pluralRu(n, ["AMP-домен", "AMP-домена", "AMP-доменов"])}`,
      failingTitle: "Не проходят в «Блокировках»",
      failingSome: (n: number) => `не проходят: ${n}`,
      failingNonePill: "все проходят",
      failingNoChecksPill: "проверок не было",
      failingPeriod: "Период",
      failingHelp:
        "Домены из выдачи за этот период, у которых хотя бы один прокси ответил не PASS, — по последней проверке каждого домена внутри периода.",
      failingNone: "Все домены, проверенные за этот период, проходят.",
      failingNoChecks: "За этот период ничего не проверено.",
      failingUnchecked: (n: number) => `Не проверено за этот период: ${n}.`,
      failingLink: "Все статусы — на вкладке «Блокировки»",
      failingMain: (n: number) => `Основные домены: ${n}`,
      failingAmp: (n: number) => `AMP-домены: ${n}`,
      failingNoneOfKind: "Нет.",
      keywordsHint: "По скольким разным запросам домен есть в выдаче этой страны — по последней проверке каждого запроса.",
      checked: (when: string) => `проверен ${when}`,
      direct: "без выдачи",
      unchecked: "не проверен",
      reason: {
        geoOff: "этот GEO выключен для отправки",
        neverSent: "ещё не отправлялся в Proxy Checker",
        refused: (when: string, code: number | null) =>
          (code ? `отправлен ${when}, отклонено · HTTP ${code}` : `отправлен ${when}, ответа нет`),
        notRead: (when: string) => `отправлен ${when}, в ответе о нём ничего нет`,
      },
      empty: "За этот период нет ни доменов проекта в выдаче, ни ответов прокси.",
      emptyFilter: "Под фильтр не подходит ни один домен.",
    },
    geos: {
      title: "GEO проекта",
      notSaved: "ещё не сохранено",
      help:
        "Все страны, в которых работает проект. Задаются здесь один раз: подключённые инструменты выбирают из этого списка — карточка Proxy Checker на вкладке «Блокировки» определяет, находки по каким GEO отправлять.",
      label: "Страны",
      placeholder: "Добавить страну…",
      fromJobs: "Список ещё не сохранён: это страны, которые сейчас проверяют задачи проекта. Поправьте список и сохраните.",
      noJob: (codes: string) =>
        `Ни одна задача проекта пока не проверяет ${codes}, поэтому находок по выдаче для отправки там нет. Добавьте задачу с локацией в этой стране или уберите её из списка.`,
    },
    ampRotator: {
      title: "AMP Rotator",
      connected: (n: number) => `${n} ${pluralRu(n, ["эндпоинт", "эндпоинта", "эндпоинтов"])}`,
      notConnected: "не подключён",
      help:
        "Сообщает SERP Monitor сегодняшний AMP-домен каждого домена проекта. Один раз сохраните логин и пароль — они общие для всех ротаторов, — затем добавьте ротатор каждого проекта: выберите проект, укажите адрес ротатора и время, когда его опрашивать. SERP Monitor отправляет ротатору все домены проекта и сохраняет AMP-домен, который тот назвал для каждого; домены, которые ротатор не обслуживает, пропускаются. У проекта может быть несколько ротаторов.",
      access: "Логин и пароль — одни для всех ротаторов",
      accessHint:
        "Все эндпоинты ниже опрашиваются с этими логином и паролем (HTTP Basic). Пароль сохраняется и больше не показывается.",
      accessNeeded: "Сначала сохраните логин и пароль: без них ни один ротатор опросить нельзя.",
      accessClearConfirm: "Забыть логин и пароль? Эндпоинты останутся, но запросов не будет, пока пара не сохранена снова.",
      login: "Логин",
      col: {
        project: "Проект", endpoint: "Эндпоинт", time: "Запрос каждый день в", last: "Последний запрос",
        domain: "Домен", amp: "AMP-домен сегодня", since: "Активен с", rotator: "Ротатор",
      },
      password: "Пароль",
      passwordKeep: "оставьте пустым, чтобы не менять",
      passwordSaved: "пароль сохранён",
      passwordMissing: "пароль ещё не сохранён",
      time: "Время запроса, каждый день (по вашим часам)",
      timeHint:
        "Ротаторы переключаются раз в сутки: укажите время после переключения этого ротатора. Если SERP Monitor в это время не работает, он запросит при запуске.",
      formAdd: "Добавить эндпоинт",
      formEdit: "Изменить эндпоинт",
      chooseProject: "Выберите проект…",
      noProjects: "Проектов пока нет: сначала создайте проект.",
      formHint:
        "Время запроса у каждого эндпоинта своё; логин и пароль выше — общие. Отдельной проверки нет: после добавления нажмите «Получить сейчас» и посмотрите результат в строке.",
      added: "Добавлено. Нажмите «Получить сейчас», чтобы проверить.",
      config: {
        button: "AMP-конфиг",
        hint: "Загрузите AMP-конфиг этого ротатора (JSON), чтобы узнать прежние AMP-домены сайтов.",
        help: "«AMP-конфиг»: загрузите файл конфигурации ротатора (JSON — список сайтов с их «amps»). Для каждого сайта проекта AMP-домены, которые стоят в списке перед тем, что ежедневная проверка видела последним, — его прежние AMP-домены, из времени до проверок SERP Monitor: они считаются доменами проекта на вкладке «Позиции» и уходят в Proxy Checker, если попадутся в выдаче. Те, что стоят в списке после, ещё не использовались и не берутся. Повторная загрузка добавляет только новое.",
        last: (when: string, added: number) => `AMP-конфиг ${when} · прежних AMP-доменов: ${added}`,
        resultTitle: (project: string, added: number, sites: number) =>
          `AMP-конфиг проекта ${project}: добавлено прежних AMP-доменов — ${added}, сайтов в файле — ${sites}`,
        known: (n: number) => `Уже были известны: ${n}.`,
        siteOk: (n: number, current: string) => `прежних AMP-доменов: ${n} (стоят в списке перед ${current} — тем, что ежедневная проверка видела последним)`,
        siteNotInProject: "нет среди доменов проекта — пропущен",
        siteNeverChecked: "ежедневная проверка ещё не видела его AMP-домена, поэтому непонятно, какие были раньше, — пропущен",
        siteCurrentNotListed: (current: string) => `его текущего AMP-домена ${current} нет в списке, поэтому непонятно, какие были раньше, — пропущен`,
      },
      deleteConfirm: (project: string) => `Удалить этот эндпоинт проекта ${project} и полученные с него AMP-домены?`,
      fetchNow: "Получить сейчас",
      fetching: "Запрашиваю…",
      neverFetched: "ещё не запрашивался",
      fetchedOk: (amp: number, sent: number) =>
        `${amp} ${pluralRu(amp, ["AMP-домен", "AMP-домена", "AMP-доменов"])} на ${sent} отправленных`,
      fetchFailed: (code: number | null) => (code ? `ошибка · HTTP ${code}` : "нет ответа"),
      nextRun: (when: string) => `следующий: ${when}`,
      projectTitle: "AMP-домены сегодня",
      projectHelp: "Сегодняшний AMP-домен каждого домена проекта — по последнему ответу его AMP Rotator. Результаты на этих доменах и на тех, что были названы в прежние дни, считаются результатами проекта на вкладке «Позиции».",
      settingsLink: "Эндпоинты задаются в «Настройки → Подключение инструментов»",
      fetchedAt: (when: string) => `получено ${when}`,
      projectFailed: (url: string, when: string) =>
        `Последний запрос к ${url} не удался (${when}), поэтому ниже — его предыдущий ответ.`,
      projectNever: "Запросов ещё не было. Нажмите «Получить сейчас».",
      projectEmpty: "Ротатор ответил, но не назвал AMP-домен ни для одного домена проекта.",
    },
    direct: {
      title: "Проверка без выдачи",
      help:
        "Отправляет выбранные домены в Proxy Checker, даже если выдачу не проверяли, — по расписанию или один раз кнопкой «Проверить сейчас». По одному запросу на каждый выбранный GEO; вместе с доменом уходит его сегодняшний AMP-домен. Ответы появляются в таблице выше.",
      toggle: "Проверять по расписанию",
      off: "выключено",
      howOften: "Как часто",
      every: (h: number) =>
        h === 1 ? "каждый час"
          : h < 24 ? `каждые ${h} ${pluralRu(h, ["час", "часа", "часов"])}`
            : h === 24 ? "раз в сутки"
              : h === 168 ? "раз в неделю"
                : `раз в ${h / 24} ${pluralRu(h / 24, ["день", "дня", "дней"])}`,
      domains: "Домены",
      allDomains: "Все домены, в том числе добавленные в проект позже",
      allHint: "Снимите «Все домены», чтобы выбрать их по одному.",
      domainsHint: "Нажмите на домен, чтобы выключить или включить его.",
      noneChosen: "Не выбран ни один домен — проверять нечего.",
      noDomains: "У проекта пока нет доменов: добавьте их в настройках проекта.",
      ampTitle: (hosts: string) => `Вместе с ним уходит его сегодняшний AMP-домен: ${hosts}`,
      allGeos: "Все GEO проекта, в том числе добавленные позже",
      allGeosHint: "Снимите «Все GEO проекта», чтобы выбрать их по одному.",
      geosHint: "Нажмите на GEO, чтобы выключить или включить его.",
      noGeoChosen: "Не выбран ни один GEO — проверять нечего.",
      geosFromProject: "GEO проекта задаются в карточке «GEO проекта» на вкладке «Обзор».",
      geosFromJobs:
        "GEO проекта не заданы, поэтому берутся страны из задач проекта. Задать их можно в карточке «GEO проекта» на вкладке «Обзор».",
      geosNone: "У проекта нет GEO: добавьте их в карточке «GEO проекта» на вкладке «Обзор». Без GEO проверять нечего.",
      onHint: (every: string) => `Выбранные домены уходят в Proxy Checker ${every}, считая от момента сохранения.`,
      offHint: "Выключено: по расписанию ничего не проверяется.",
      nextRun: (when: string) => `Следующая проверка: ${when}.`,
      lastAt: (when: string) => `Последняя проверка: ${when}.`,
      checkNow: "Проверить сейчас",
      checking: "Проверка…",
      checkNowHint: "Один раз и сразу отправляет выбранные выше домены по выбранным GEO — расписание может быть выключено, а выбор не сохранён.",
      resultMore: "Запросы и ответы — в «Последних отправках» в карточке Proxy Checker ниже.",
    },
    project: {
      title: "Proxy Checker",
      help:
        "Отправляет в Proxy Checker домены этого проекта, найденные в выдаче при проверках, — по одному запросу на страну, только те домены, которые там действительно нашлись.",
      notConnected: "Proxy Checker ещё не подключён, поэтому ничего отправляться не будет.",
      connectLink: "Подключить в «Настройки → Подключение инструментов»",
      when: "Когда отправлять",
      modeDaily: "Раз в день",
      modeInherit: "Как в настройках",
      modeInheritOn:
        "По общей настройке в «Настройки → Подключение инструментов», а она сейчас такая: сразу после завершения каждой проверки проекта или загрузки CSV — домены, найденные в ней.",
      modeInheritOff:
        "По общей настройке в «Настройки → Подключение инструментов», а там автоматическая отправка сейчас выключена: само ничего не отправляется. Кнопка «Отправить сейчас» ниже работает всегда.",
      bySettings: "как в настройках",
      settingsLink: "Изменить там",
      modeOffHint: "Автоматически ничего не отправляется. Кнопка «Отправить сейчас» ниже работает всегда.",
      modeAfterRunHint: "Сразу после завершения каждой проверки проекта или загрузки CSV: домены, найденные в ней.",
      modeDailyHint: (hours: number) => `Раз в день в указанное время: все домены, найденные за последние ${hours} ч.`,
      time: "в (по вашим часам)",
      nextRun: (when: string) => `Следующая отправка: ${when}.`,
      previewTitle: (hours: number) => `Будет отправлено сейчас — проверено или загружено за последние ${hours} ч`,
      previewEmpty: (hours: number) =>
        `За последние ${hours} ч не было ни проверки, ни загрузки CSV с доменами проекта — отправлять нечего.`,
      previewAmpNote:
        "Домены с пометкой AMP — AMP-домены из AMP Rotator проекта. AMP-домен отправляется для страны, если он сам найден в её выдаче; кроме того, вместе с каждым найденным доменом отправляется его сегодняшний AMP-домен.",
      sendNow: "Отправить сейчас",
      sending: "Отправка…",
      sendNowHint: (hours: number) => `Отправляет найденное в проверках и загруженных CSV за последние ${hours} ч независимо от расписания.`,
      sentResult: (ok: number, total: number) => `Отправлено: принято ${ok} из ${total}.`,
      nothingToSend: "Отправлять нечего.",
      countries: (n: number) => `${n} ${pluralRu(n, ["страна", "страны", "стран"])}`,
      geos: "GEO для отправки",
      geosHint:
        "Нажмите на страну, чтобы выключить или включить её. Отправляются находки только по включённым GEO; число — сколько доменов проекта найдено там в проверках и загруженных CSV за последние 24 ч. Пока включены все, GEO, добавленный в проект позже, тоже будет отправляться.",
      geosEmpty: "Не включён ни один GEO — ничего отправляться не будет.",
      geosNone: "У проекта пока нет GEO: добавьте их в карточке «GEO проекта» на вкладке «Обзор».",
      geoFound: (n: number, hours: number) => `Доменов проекта найдено за последние ${hours} ч: ${n}`,
      saveFirst: "Сначала сохраните изменения.",
    },
  },
  settings: {
    title: "Настройки",
    intro: "Сгруппированы по части приложения, которую они настраивают.",
    tabs: {
      monitor: {
        label: "Мониторинг выдачи",
        intro: "Доступы к SERP API, стоимость запроса, веса позиций и сохранённые локации.",
      },
      analyzer: {
        label: "Анализатор выдачи",
        intro: "Ahrefs, AI-провайдеры, промпт оценки сложности выдачи и формула возможности.",
      },
      tools: {
        label: "Подключение инструментов",
        intro: "Другие инструменты, которым SERP Monitor передаёт найденное.",
      },
    },
    addLocation: {
      title: "Добавить локацию",
      help: (
        <>
          <code>canonical_name</code> использует формат SerpAPI с разделителями-запятыми.{" "}
          <code>yandex_lr</code> — числовой ID региона Яндекса, нужен для
          городского таргетинга Яндекса (напр. Москва=213, Алматы=162, Ташкент=10335).
        </>
      ),
      phCanonical: "canonical_name",
      phName: "отображаемое имя",
      phCc: "cc (kz, uz…)",
      phType: "тип…",
      phYandexLr: "yandex_lr",
      typeOptions: {
        Country: "Страна",
        Region: "Регион",
        City: "Город",
        Other: "Другое",
      },
    },
    bulk: {
      title: "Массовый импорт",
      help: (
        <>
          По одной записи на строку. Колонки разделяются табуляцией или вертикальной
          чертой:
          <code> canonical_name | name | country_code | target_type | yandex_lr</code>.
          Обязательна только первая колонка. Дубликаты пропускаются автоматически.
        </>
      ),
      result: (added: number, skipped: number) =>
        `Добавлено: ${added}, пропущено: ${skipped} (дубликаты)`,
    },
    list: {
      title: "Сохранённые локации",
      perProviderHelp: (
        <>
          Что отправляется в каждый провайдер на основе строки:{" "}
          <span className="text-neutral-700 dark:text-neutral-200 font-medium">
            SerpAPI
          </span>{" "}
          использует <code>location=canonical_name</code> и <code>gl=CC</code>.{" "}
          <span className="text-neutral-700 dark:text-neutral-200 font-medium">
            Bright Data Google
          </span>{" "}
          использует <code>gl=CC</code> и вычисленное <code>uule=</code> ниже.{" "}
          <span className="text-neutral-700 dark:text-neutral-200 font-medium">
            Oxylabs Google
          </span>{" "}
          использует <code>geo_location=canonical_name</code> (нечёткий поиск
          по собственной БД Oxylabs; при отсутствии города в их базе откатывается
          до уровня страны).{" "}
          <span className="text-neutral-700 dark:text-neutral-200 font-medium">
            Яндекс
          </span>{" "}
          (любой провайдер) использует <code>lr=yandex_lr</code>.
        </>
      ),
      cols: {
        canonical: "canonical_name",
        name: "Имя",
        cc: "CC",
        type: "Тип",
        yandexLr: "yandex_lr",
        uule: "uule (Bright Data Google)",
      },
      empty: "Локации не найдены.",
      deleteConfirm: "Удалить эту локацию?",
      copyUuleTitle: "Скопировать полный UULE",
    },
    aiAnalysis: {
      title: "AI-оценка сложности выдачи",
      help:
        "Промпт для оценки каждого ключевого слова. Модель получает одну общую таблицу на ключевое слово — каждый результат выдачи вместе с его метриками Ahrefs в той же строке — и возвращает сложность и комментарий на 1-3 предложения. Ваши правки никогда не перезаписываются обновлением.",
      customised: "изменён",
      usingDefault: "по умолчанию",
      providerLabel: "Провайдер для оценки",
      providerAuto: "Авто (единственный настроенный провайдер)",
      providerOff: "Выключено — только метрики",
      promptLabel: "Промпт",
      placeholders: "Доступные подстановки: {keyword} и {table}. Подставляются при запуске. Промпт можно писать на любом языке — от него зависит только текст комментария; значение сложности остаётся low/medium/hard/too hard, а интерфейс переводит его сам.",
      reset: "Сбросить к значению по умолчанию",
      loadRu: "Загрузить русскую версию",
      domainTitle: "Блок метрик уровня домена",
      domainHelp: "Текст, который ставится над таблицей доменов. Используется только если в задаче выбраны доменные метрики. Отредактируйте его, чтобы настроить, как модель отличает настоящие авторитетные сайты от PBN-сеток — колонки органических ключей здесь самый сильный признак. Необязательная подстановка {domain_table} задаёт место таблицы; иначе она добавляется снизу.",
      domainReset: "Сбросить блок доменов",
      domainLoadRu: "Загрузить русскую версию",
      unsaved: "Не сохранено — нажмите «Сохранить»",
      resetConfirm:
        "Отменить изменённый промпт и вернуться к встроенному по умолчанию?",
      resetDone: "Сброшено к встроенному промпту.",
    },
    ahrefs: {
      title: "Ahrefs",
      help:
        "Обеспечивает режим анализатора выдачи: ссылочные метрики для каждого URL из выдачи через /batch-analysis в режиме точного URL. API-ключ — на ahrefs.com/api.",
      apiKey: "API-ключ",
      apiKeyPlaceholder: "API-токен Ahrefs",
      clearConfirm: "Очистить сохранённый API-ключ Ahrefs?",
      testOk: (units: number) => `✓ Работает — тестовый запрос стоил ${units} юнит(ов)`,
      footnote:
        "У Ahrefs нет бесплатной проверки ключа, поэтому «Проверить» выполняет один реальный запрос по одному URL (~1 юнит). Прогоны анализатора тарифицируются примерно как 1 юнит за URL за каждую выбранную метрику; дубликаты URL внутри прогона запрашиваются один раз.",
    },
    ai: {
      title: "AI-провайдеры",
      help:
        "Доступ к Gemini для оценки сложности выдачи в анализаторе. Настройте одного провайдера и проверьте его здесь — задачи анализатора используют его.",
      authServiceAccount: "сервисный аккаунт",
      authExpress: "Express (API-ключ)",
      testing: "Проверка…",
      testOk: (model: string) => `✓ Работает — модель ${model}`,
      testTokens: (p: number, c: number) => `${p} токенов запроса + ${c} токенов ответа`,
      testNote:
        "Ни один из Google API не даёт бесплатной проверки ключа, поэтому «Проверить» выполняет реальную генерацию из одного слова — несколько токенов. В токены ответа входят «мыслительные» токены Gemini, которые тарифицируются по ставке вывода.",
      clearConfirm: (provider: string) =>
        `Очистить все сохранённые настройки для ${provider}?`,
      meta: {
        common: {
          model: { label: "Модель по умолчанию" },
        },
        ai_studio: {
          help:
            "Самый простой вариант: один API-ключ с aistudio.google.com/apikey. Подходит для тестов и небольших объёмов; квоты привязаны к ключу, на бесплатном тарифе щедрые.",
          api_key: { label: "API-ключ", placeholder: "AIza…" },
        },
        vertex: {
          help:
            "Два способа подключения. JSON сервисного аккаунта + проект + регион — рабочий вариант с полной квотой. Vertex Express (только API-ключ) настраивается быстрее, но жёстко ограничен по лимитам. Если заполнено и то и другое, приоритет у сервисного аккаунта. Только модели Gemini.",
          service_account_json: {
            label: "JSON сервисного аккаунта",
            placeholder: '{"type":"service_account","project_id":"…","private_key":"…"}',
          },
          project_id: { label: "ID проекта" },
          location: { label: "Регион (location)" },
          api_key: { label: "Express API-ключ (альтернатива)", placeholder: "AIza…" },
        },
      },
    },
    visibility: {
      title: "Веса видимости",
      help:
        "Сколько стоит каждая позиция выдачи — как доля страницы. Используется для колонки «Видимость» в средних позициях проекта. Значения по умолчанию резкие: половина страницы приходится на первую позицию, потому что инструмент следит за брендовыми запросами, где первый результат забирает долю, немыслимую для информационного запроса.",
      isDefault: "кривая по умолчанию",
      customised: "изменена",
      colPosition: "Позиция",
      colWeight: "Вес",
      colShare: "Доля страницы",
      colCumulative: "Топ-N держит",
      addSlot: "+ позиция",
      removeSlot: "− позиция",
      depth: (n: number) => `Позиций: ${n} — всё ниже #${n} считается невидимым`,
      allZero: "Хотя бы один вес должен быть больше нуля, иначе на странице ничего не стоит ничего.",
      reset: "Вернуть по умолчанию",
      footnote:
        "Важны только соотношения: 5/2/1 означает то же, что 50/20/10, потому что каждая оценка делится на вес, задействованный на измеряемой странице. Это же калибрует короткую выдачу: если результатов семь, та же сумма делится между этими семью позициями. Пропуски от рекламы не перераспределяются — это внимание ушло рекламе. Изменение кривой сразу пересчитывает все представления, включая прошлые прогоны: это способ читать измерения, а не часть самих измерений.",
    },
    rates: {
      title: "Стоимость запросов",
      help:
        "Сколько вы платите за один запрос у каждого провайдера. Используется для расчёта стоимости в форме задачи и для прогонов, где провайдер не возвращает реальную цену. Ставки зависят от вашего тарифа — укажите свои.",
      usingDefault: "значение по умолчанию",
      defaultIs: (v: string) => `по умолчанию: $${v}`,
      footnote:
        "DataForSEO возвращает реальную стоимость каждого запроса, поэтому его прогоны записывают фактические траты и эту ставку игнорируют. SerpAPI, Bright Data и Oxylabs цену не возвращают — их прогоны считаются по ставке выше. Очистите поле, чтобы вернуть значение по умолчанию.",
    },
    providers: {
      title: "Провайдеры",
      configured: "настроено",
      partial: "частично",
      notSet: "не задано",
      savedSecret: (last4: string, length: number) => (
        <>
          Сохранено: <code>••••{last4}</code> ({length} симв.)
        </>
      ),
      savedPlain: (value: string) => (
        <>
          Сохранено: <code>{value}</code>
        </>
      ),
      savedNoDetail: "Сохранено.",
      worksOk: (provider: string) => `✓ ${provider} работает.`,
      plan: (plan: string) => (
        <>
          {" "}Тариф: <strong>{plan}</strong>.
        </>
      ),
      searchesLeft: (n: number) => (
        <>
          {" "}Осталось запросов: <strong>{n}</strong>.
        </>
      ),
      balance: (n: number) => (
        <>
          {" "}Баланс: <strong>${n}</strong>.
        </>
      ),
      clearConfirm: (provider: string) =>
        `Очистить все сохранённые учётные данные для ${provider}?`,
      meta: {
        serpapi: {
          help: "Провайдер по умолчанию. Получите ключ на serpapi.com/manage-api-key. Значение в БД переопределяет SERPAPI_KEY из .env.",
          api_key: { label: "API-ключ", placeholder: "Вставьте ключ SerpAPI…" },
        },
        brightdata: {
          help:
            "Рекомендуем две зоны: `zone` с типом Full JSON для Google и `zone_raw` с типом Raw HTML для Яндекса (парсер Full JSON Bright Data на большинстве тарифов не покрывает Яндекс, поэтому мы получаем страницу и парсим её сами). Если нужен только Google, оставьте `zone_raw` пустым.",
          token: {
            label: "API-токен",
            placeholder: "Bearer-токен из панели Bright Data",
          },
          zone: {
            label: "Зона (Full JSON, для Google)",
            placeholder: "напр. serp_api1",
          },
          zone_raw: {
            label: "Зона (Raw HTML, для Яндекса) — необязательно",
            placeholder: "напр. serp_raw",
          },
        },
        oxylabs: {
          help: "SERP Scraper API на realtime.oxylabs.io. Используйте имя пользователя и пароль из суб-аккаунта Oxylabs SERP Scraper.",
          username: {
            label: "Имя пользователя",
            placeholder: "Имя пользователя Oxylabs SERP",
          },
          password: { label: "Пароль", placeholder: "Пароль Oxylabs" },
        },
        dataforseo: {
          help:
            "Только Google — у DataForSEO нет эндпоинта для Яндекса. Режим Live (~$0.002 за запрос, результат за несколько секунд). Учётные данные — на app.dataforseo.com/api-access; API-пароль генерируется автоматически и НЕ совпадает с паролем от аккаунта. Проверка бесплатна (запрашивает баланс, не тратя кредиты).",
          login: { label: "Логин (email)", placeholder: "you@example.com" },
          password: { label: "API-пароль", placeholder: "Сгенерированный API-пароль" },
        },
      },
    },
  },
  combobox: {
    searching: "Поиск…",
    noMatches: "Ничего не найдено.",
  },
  cost: {
    estimated: "оц.",
    actualHint: "Фактическая стоимость, полученная от провайдера",
    estimateHint: "Оценка: количество запросов × ставка из «Настроек»",
  },
  compare: {
    title: "Сравнение провайдеров",
    subtitle: "Одни и те же запросы, отправленные каждому провайдеру",
    summaryTitle: "Провайдеры",
    colProvider: "Провайдер",
    colAnswered: "Ответил",
    colFailed: "Ошибки",
    colUnsupported: "Не поддерж.",
    colRetried: "Повторы",
    retriedHint:
      "Запросы, которым понадобилось больше одной попытки. Временные сбои провайдера — пустой ответ, упавшее задание, страница с капчей — повторяются автоматически, до 3 попыток, прежде чем запрос считается ошибочным.",
    answeredOnAttempt: (n: number) => `Ответ получен с попытки ${n} — предыдущие не удались и были повторены автоматически.`,
    colResults: "Результаты",
    colAvgResults: "В среднем на SERP",
    colCost: "Стоимость",
    answeredOf: (ok: number, total: number) => `${ok} из ${total}`,
    retry: (n: number) => `Повторить ошибочные: ${n}`,
    retrying: "Повторяем…",
    basis: (common: number, total: number) =>
      common === total
        ? total === 1
          ? "Домены и URL ниже — по единственному запросу прогона, на него ответил каждый провайдер."
          : `Домены и URL ниже посчитаны по всем ${total} ${pluralRu(total, ["запросу", "запросам", "запросам"])} — каждый провайдер ответил на каждый.`
        : `Домены и URL ниже посчитаны по ${common} из ${total} запросов, на которые ответили все провайдеры. Остальные исключены, чтобы ошибка одного провайдера не выглядела как пропавшие домены — они видны в таблице «Результаты по SERP».`,
    nobodyAnswered: (engine: string) =>
      `Ни один провайдер не ответил ни на один запрос ${engine} — сравнивать пока нечего.`,
    onlyOneAnswered: (engine: string) =>
      `На запросы ${engine} ответил только один провайдер — сравнивать не с чем.`,
    noAnswers: "нет ответов",
    noAnswersHint: "Все запросы к этому провайдеру по этому поисковику завершились ошибкой, поэтому он исключён из сравнения.",
    onlyDifferences: "Только расхождения",
    shownHostOn:
      "Эта задача приводит AMP и CDN к показанному сайту, поэтому домены считаются так, как их показал поисковик, — провайдеры, которые отдают технический хост, и провайдеры, которые отдают издателя, совпадают. URL по-прежнему сравниваются по ссылке. Приведённые результаты помечены ⇄.",
    substitutedRow: (from: string) => `Засчитан как показанный сайт. Ссылки вели на: ${from}`,
    domainsTitle: "Домены",
    urlsTitle: "URL",
    countsTitle: "Результаты по SERP",
    colDomain: "Домен",
    colUrl: "URL",
    colFoundBy: "Нашли",
    colQuery: "Запрос",
    cellHint: (count: number, avg: string, best: number) =>
      `${count} ${pluralRu(count, ["результат", "результата", "результатов"])} · средняя позиция ${avg} · лучшая ${best}`,
    notReturned: "этот провайдер его не вернул",
    statusFailed: "ошибка",
    statusUnsupported: "н/д",
    statusUnsupportedHint: "Провайдер не умеет работать с этим поисковиком; запрос не отправлялся.",
    statusPending: "…",
    statusPendingHint: "Ответ ещё не записан.",
    noRows: "Нечего показать.",
    noDifferences: "Расхождений нет — все провайдеры совпадают.",
    keywordsTitle: "Выдача по ключевым словам",
    keywordSummary: (queries: number, differing: number) =>
      `${queries} ${pluralRu(queries, ["запрос", "запроса", "запросов"])} · ${differing ? `с расхождениями: ${differing}` : "расхождений нет"}`,
    colPosition: "#",
    legendTitle: "Подсветка",
    markSame: "Есть в выдаче каждого провайдера",
    markPage: "Сайт есть у других, но другая страница",
    markSite: "Сайта нет в выдаче другого провайдера",
    serpFailed: "Запрос завершился ошибкой",
    serpEmpty: "Пустая выдача",
    serpUnsupported: "Не поддерживается",
    footnote:
      "URL сравниваются без учёта http/https, ведущего www., завершающего слэша и #якоря — провайдеры расходятся в этом для одной и той же страницы. Домены сравниваются без www. Всё остальное — путь и параметры запроса — должно совпадать.",
  },
};

const messages = { en: messagesEn, ru: messagesRu };

/** The report picks its own language independently of the app toggle: it is
 *  produced for a Russian-speaking reader regardless of who generated it. */
export function messagesFor(lang: Lang): Messages {
  return messages[lang];
}

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Messages;
};

const LangContext = createContext<Ctx | null>(null);

export function LangProvider({
  children,
  initial = "en",
}: {
  children: ReactNode;
  initial?: Lang;
}) {
  const [lang, setLangState] = useState<Lang>(initial);

  // Re-sync from DOM after mount: the pre-paint script in <html> has already
  // set `<html lang>` from localStorage by the time React hydrates, so we
  // just read it back instead of touching localStorage twice.
  useEffect(() => {
    const fromHtml = document.documentElement.lang;
    if (fromHtml === "ru" || fromHtml === "en") {
      setLangState(fromHtml);
    }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {}
    document.documentElement.lang = l;
  }, []);

  const value: Ctx = { lang, setLang, t: messages[lang] };
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useT(): Ctx {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useT must be used inside <LangProvider>");
  return ctx;
}
