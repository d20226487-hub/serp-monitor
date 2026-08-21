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
  },
  nav: {
    jobs: "Jobs",
    newJob: "New job",
    settings: "Settings",
    docs: "Документация",
  },
  home: {
    title: "Jobs",
    newJob: "+ New job",
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
  formula: {
    title: "Opportunity formula",
    subtitle:
      "How keywords in a run are ranked. Set the defaults here; any run can override them.",
    equation:
      "Opportunity = (Volume^wv × Winnability^ww)^½ · Winnability = Bar × Soft × AI",
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
    subtitle: (depth: number, size: number, ranker: string) =>
      depth === 0
        ? `Entry bar across the whole SERP — the ${size} weakest domains by ${ranker}, averaged`
        : `Entry bar for the top ${depth} — the ${size} weakest domains by ${ranker}, averaged`,
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
    empty: "No analysis yet. Run this job to collect Ahrefs metrics.",
    units: (n: number) => `${n.toLocaleString()} Ahrefs units`,
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
    rawTitle: "Raw Ahrefs data for every URL in this SERP",
    rawDomainTitle: "Domain-level metrics for the sites above",
    colDomain: "Domain",
    colAge: "Age",
    colRegistrar: "Registrar",
    ageHint: (created: string, registrable: string) =>
      `Registered ${created} (${registrable})`,
    ageSubdomainHint: (created: string, registrable: string) =>
      `Subdomain — this is the age of ${registrable}, registered ${created}`,
    ageUnknownHint: "DataForSEO's WHOIS database has no record for this domain",
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
  jobForm: {
    mode: "Mode",
    modeSerp: "1 · SERP monitoring",
    modeSerpHelp: "Scrape SERPs and review domain / URL distribution.",
    modeAnalyzer: "2 · SERP analyzer",
    modeAnalyzerHelp:
      "Scrape SERPs, then pull Ahrefs metrics for every result URL and show ranking difficulty per keyword.",
    ahrefsMetrics: "Ahrefs metrics",
    ahrefsMetricsHelp:
      "Which metrics to pull for each result URL. Analysed in exact-URL mode, so UR is per page rather than per domain.",
    whois: "Domain age (WHOIS)",
    whoisHelp:
      "Look up when each domain was registered and give the age to the AI. A site with hundreds of referring domains and no top-10 keywords reads very differently at six months old than at ten years.",
    whoisCost:
      "Uses DataForSEO WHOIS. Billed per request (~$0.12), not per domain, and only when a domain isn't already cached — registration dates don't change, so a recurring job pays once and then reads the cache.",
    whoisNoCreds:
      "⚠ DataForSEO credentials are not set — domain age will fail for this job. Add them in Settings → DataForSEO.",
    ahrefsNoKey:
      "⚠ No Ahrefs API key configured — analyzer runs will fail. Add one in Settings → Ahrefs.",
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
    keywordsHint: "(one per line, max 100)",
    keywordsPlaceholder: "acme login\nacme review\nacme скачать",
    keywordsCount: (n: number) => `${n} keyword(s)`,
    provider: "Provider",
    providerHelpPrefix: "Configure provider credentials in ",
    providerHelpLink: "Settings",
    providerHelpSuffix:
      " first. Each provider differs slightly: SerpAPI and DataForSEO accept canonical_name locations; Bright Data & Oxylabs only honor country / yandex_lr.",
    dataforseoNoYandex:
      "⚠ DataForSEO has no Yandex endpoint — their SERP API covers Google, Bing, Yahoo, Baidu, Naver and Seznam only. Yandex searches in this job will fail. Use SerpAPI, Bright Data or Oxylabs for Yandex, or remove Yandex from Engines and keep DataForSEO for Google.",
    engines: "Engines",
    enginesPlaceholder: "Pick engines…",
    devices: "Devices",
    devicesPlaceholder: "Pick devices…",
    locations: "Locations (countries / regions / cities)",
    locationsPlaceholder: "Pick from saved or search SerpAPI…",
    languages: "Languages",
    languagesPlaceholder: "Pick languages…",
    googleDomains: "Google domains (optional)",
    googleDomainsPlaceholder: "Defaults from country if empty",
    fieldsToScrape: "Fields to scrape",
    topN: "Top N positions",
    schedule: "Schedule",
    cronHelpPrefix: (tz: string) => (
      <>
        Cron expression in <strong>{tz}</strong>. E.g. <code>0 */6 * * *</code> = every 6 hours.
      </>
    ),
    cronEditHint: (
      <>
        {" "}Edit <code>scheduler.py</code> &amp; restart api to change.
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
    estimateDepthNote: (units: number, topN: number) =>
      `⚠ DataForSEO bills per 10 results — Top N ${topN} counts as ${units} SERPs per search (${units}× the price). Lower Top N to 10 to pay the base rate.`,
    saveCreate: "Create job",
    saveChanges: "Save changes",
    saveAndRunCreate: "Create & run now",
    saveAndRunUpdate: "Save & run now",
    engineOptions: { google: "Google", yandex: "Yandex" },
    deviceOptions: { desktop: "Desktop", mobile: "Mobile" },
    scrapeFieldOptions: {
      url: "URL",
      title: "Title",
      description: "Meta description",
    },
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
  settings: {
    title: "Settings",
    intro: "Configure provider credentials and curate your saved locations.",
    addLocation: {
      title: "Add a location",
      help: (
        <>
          <code>canonical_name</code> uses SerpAPI&rsquo;s comma-separated format.{" "}
          <code>yandex_lr</code> is Yandex&rsquo;s numeric region ID — required for
          city-level Yandex targeting (e.g. Moscow=213, Almaty=162, Tashkent=11353).
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
      heading: (n: number) => `Saved locations (${n})`,
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
        "Gemini access for upcoming AI features. Nothing uses these yet — configure and test them now so the plumbing is proven before the first feature lands.",
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
  },
  nav: {
    jobs: "Задачи",
    newJob: "Новая задача",
    settings: "Настройки",
    docs: "Документация",
  },
  home: {
    title: "Задачи",
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
  formula: {
    title: "Формула перспективности",
    subtitle:
      "Как ранжируются ключевые слова в запуске. Здесь задаются значения по умолчанию; любой запуск может их переопределить.",
    equation:
      "Перспективность = (Частотность^wv × Шансы^ww)^½ · Шансы = Порог × Слабые × AI",
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
    subtitle: (depth: number, size: number, ranker: string) =>
      depth === 0
        ? `Порог входа по всей выдаче — среднее по ${size} самым слабым доменам по ${ranker}`
        : `Порог входа в топ-${depth} — среднее по ${size} самым слабым доменам по ${ranker}`,
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
    empty: "Анализа пока нет. Запустите задачу, чтобы собрать метрики Ahrefs.",
    units: (n: number) => `${n.toLocaleString()} юнитов Ahrefs`,
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
    rawTitle: "Сырые данные Ahrefs по каждому URL этой выдачи",
    rawDomainTitle: "Метрики уровня домена для сайтов выше",
    colDomain: "Домен",
    colAge: "Возраст",
    colRegistrar: "Регистратор",
    ageHint: (created: string, registrable: string) =>
      `Зарегистрирован ${created} (${registrable})`,
    ageSubdomainHint: (created: string, registrable: string) =>
      `Поддомен — это возраст ${registrable}, зарегистрирован ${created}`,
    ageUnknownHint: "В базе WHOIS DataForSEO нет записи об этом домене",
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
  jobForm: {
    mode: "Режим",
    modeSerp: "1 · Мониторинг выдачи",
    modeSerpHelp: "Снимать выдачу и смотреть распределение доменов / URL.",
    modeAnalyzer: "2 · Анализатор выдачи",
    modeAnalyzerHelp:
      "Снять выдачу, затем получить метрики Ahrefs для каждого URL и показать сложность ранжирования по каждому ключевому слову.",
    ahrefsMetrics: "Метрики Ahrefs",
    ahrefsMetricsHelp:
      "Какие метрики запрашивать для каждого URL из выдачи. Анализ идёт в режиме точного URL, поэтому UR считается по странице, а не по домену.",
    whois: "Возраст домена (WHOIS)",
    whoisHelp:
      "Узнать дату регистрации каждого домена и передать возраст в AI. Сайт с сотнями ссылающихся доменов и без ключей в топ-10 читается совершенно по-разному в полгода и в десять лет.",
    whoisCost:
      "Используется DataForSEO WHOIS. Тарифицируется за запрос (~$0,12), а не за домен, и только если домена ещё нет в кэше — даты регистрации не меняются, поэтому регулярная задача платит один раз и дальше читает кэш.",
    whoisNoCreds:
      "⚠ Доступы DataForSEO не заданы — получение возраста домена для этой задачи завершится ошибкой. Добавьте их в «Настройки → DataForSEO».",
    ahrefsNoKey:
      "⚠ API-ключ Ahrefs не задан — запуски в режиме анализатора завершатся ошибкой. Добавьте ключ в «Настройки → Ahrefs».",
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
    keywordsHint: "(по одному на строку, не более 100)",
    keywordsPlaceholder: "acme вход\nacme отзывы\nacme скачать",
    keywordsCount: (n: number) =>
      `${n} ${pluralRu(n, ["ключевое слово", "ключевых слова", "ключевых слов"])}`,
    provider: "Провайдер",
    providerHelpPrefix: "Сначала укажите учётные данные провайдеров в разделе ",
    providerHelpLink: "Настройки",
    providerHelpSuffix:
      ". Провайдеры немного отличаются: SerpAPI и DataForSEO принимают локации в формате canonical_name; Bright Data и Oxylabs учитывают только страну / yandex_lr.",
    dataforseoNoYandex:
      "⚠ У DataForSEO нет эндпоинта для Яндекса — их SERP API поддерживает только Google, Bing, Yahoo, Baidu, Naver и Seznam. Запросы к Яндексу в этой задаче завершатся ошибкой. Используйте SerpAPI, Bright Data или Oxylabs для Яндекса, либо уберите Яндекс из поисковиков и оставьте DataForSEO для Google.",
    engines: "Поисковики",
    enginesPlaceholder: "Выберите поисковики…",
    devices: "Устройства",
    devicesPlaceholder: "Выберите устройства…",
    locations: "Геолокации (страны / регионы / города)",
    locationsPlaceholder: "Выберите из сохранённых или найдите через SerpAPI…",
    languages: "Языки",
    languagesPlaceholder: "Выберите языки…",
    googleDomains: "Домены Google (необязательно)",
    googleDomainsPlaceholder: "Если пусто — берётся из страны",
    fieldsToScrape: "Извлекаемые поля",
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
        {" "}Чтобы изменить, отредактируйте <code>scheduler.py</code> и перезапустите api.
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
    estimateDepthNote: (units: number, topN: number) =>
      `⚠ DataForSEO тарифицирует за каждые 10 результатов — Топ N ${topN} считается как ${units} SERP на запрос (цена ×${units}). Поставьте Топ N = 10, чтобы платить базовую ставку.`,
    saveCreate: "Создать задачу",
    saveChanges: "Сохранить изменения",
    saveAndRunCreate: "Создать и запустить",
    saveAndRunUpdate: "Сохранить и запустить",
    engineOptions: { google: "Google", yandex: "Yandex" },
    deviceOptions: { desktop: "Десктоп", mobile: "Мобильный" },
    scrapeFieldOptions: {
      url: "URL",
      title: "Заголовок",
      description: "Мета-описание",
    },
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
  settings: {
    title: "Настройки",
    intro:
      "Настройте учётные данные провайдеров и сохранённые локации.",
    addLocation: {
      title: "Добавить локацию",
      help: (
        <>
          <code>canonical_name</code> использует формат SerpAPI с разделителями-запятыми.{" "}
          <code>yandex_lr</code> — числовой ID региона Яндекса, нужен для
          городского таргетинга Яндекса (напр. Москва=213, Алматы=162, Ташкент=11353).
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
      heading: (n: number) => `Сохранённые локации (${n})`,
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
        "Доступ к Gemini для будущих AI-функций. Пока ничего их не использует — настройте и проверьте сейчас, чтобы интеграция была готова к первой функции.",
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
};

const messages = { en: messagesEn, ru: messagesRu };

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
