import type { OpportunityFormula } from "@/lib/opportunity";

const BASE = process.env.NEXT_PUBLIC_API_BASE || "/api";

async function req<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : (res.text() as any);
}

export type LocationRef = {
  canonical_name: string;
  name?: string | null;
  country_code?: string | null;
  target_type?: string | null;
};

/** A client or site being watched, and the domains that belong to it.
 *  Also the folder the jobs list groups by. */
export type Project = {
  id: number;
  name: string;
  /** Normalised hosts: lowercase, no scheme or path, no leading "www.".
   *  Subdomains are kept. Stored for position tracking to use later. */
  domains: string[];
  notes: string | null;
  /** What this project's jobs add up to, computed per response — the jobs
   *  decide all of it, so a stored copy would drift. */
  job_count: number;
  keyword_count: number;
  /** Locations its jobs target, deduplicated. */
  geos: string[];
  /** Engines its jobs run on. */
  engines: string[];
  created_at: string;
  updated_at: string;
};

/** One project domain's place on a SERP. Only ranked domains get one, so a
 *  project watching ten sites does not carry ten nulls per keyword. */
export type PositionHit = {
  domain: string;
  /** The best slot this domain holds — the position it "has". */
  position: number;
  /** Every slot it holds on this page, ascending. A site with three listings
   *  has taken three slots off the page, which is what a share counts. */
  positions: number[];
  /** What those slots are worth together, as a share of the page. */
  share: number;
  url: string | null;
  /** The host the link actually opens. */
  linked_host: string | null;
  /** The host the engine printed, when it reported one. */
  shown_host: string | null;
  /** The two differ: an AMP publisher, a CDN, or a doorway printing someone
   *  else's brand. Worth showing either way. */
  substituted: boolean;
  /** The job resolves to the displayed host, but the engine reported none for
   *  this result, so the raw link was used. A visible gap beats a silent
   *  fallback. */
  unresolved: boolean;
};

export type PositionRow = {
  keyword: string;
  run_id: number;
  job_id: number;
  job_name: string | null;
  checked_at: string;
  /** How much of this page the project holds between all its domains, and the
   *  raw count behind it — "44%" means nothing without "3 of 8". */
  share: number;
  slots: number;
  slots_total: number;
  /** The page was shorter than the weight curve, so the missing slots' weight
   *  was spread over the ones that were there and every share on this row is
   *  larger than it would be on a full page. A genuinely short SERP and a
   *  scrape that came back thin both land here; the slot count tells them
   *  apart. */
  short_page: boolean;
  /** What ranked, best position first. Empty = nothing of ours was in the
   *  positions that run captured. */
  hits: PositionHit[];
};

/** One results page.
 *
 *  A SERP is the whole tuple below: each field changes the page the engine
 *  returns, so two of them never share a table. */
export type SerpIdentity = {
  /** Stable identity of the tuple, for React keys. */
  key: string;
  engine: string;
  device: string;
  country_code: string | null;
  language: string | null;
  location: string | null;
  google_domain: string | null;
};

/** One results page, and every keyword measured on it. */
export type SerpGroup = SerpIdentity & {
  /** How much of this SERP the project holds on an average keyword. Averaged
   *  rather than summed: each keyword is its own page. */
  share: number;
  rows: PositionRow[];
};

/** One project domain's record on one keyword, across a window of runs. */
export type AverageHit = {
  domain: string;
  /** Mean of the runs where it RANKED. Absences have no position to average,
   *  so they are counted below instead of folded into this number. */
  avg_position: number;
  best: number;
  worst: number;
  /** How many runs it appeared in, out of how many measured the keyword. */
  ranked_in: number;
  runs: number;
  /** The same pair as a share. Presence is not rank. */
  present_pct: number;
  absent_pct: number;
  /** Share of the page this domain held, averaged over every run including
   *  the ones it was absent from. Position and presence on one scale. */
  visibility: number;
  /** Who measured the runs behind this average. */
  providers: string[];
  /** Two providers number the same slot differently — DataForSEO counts ads
   *  and AI blocks, SerpAPI does not — so this average blends two rulers. */
  mixed_providers: boolean;
  /** Readings from runs made before the provider was recorded. Not proof of a
   *  mix, but not proof against one either. */
  unknown_providers: number;
  /** How many of the readings were credited to the host the engine displayed
   *  rather than the one the link opens. */
  substituted_in: number;
};

export type AverageRow = {
  keyword: string;
  /** Runs that measured this keyword on this SERP. */
  runs: number;
  /** How much of this page the project holds between all its domains. Shares
   *  are fractions of one page, so they add up: owning every slot is 100. */
  visibility: number;
  /** What ranked at least once, best average first. Empty = nothing of ours
   *  appeared in any run of the window. */
  hits: AverageHit[];
};

export type AverageSerpGroup = SerpIdentity & { runs: number; rows: AverageRow[] };

type RunRef = {
  id: number; job_id: number; job_name: string | null;
  status: string; started_at: string;
  /** Which provider produced the run. null on runs from before this was
   *  recorded — positions are not comparable across providers. */
  provider: string | null;
};

export type ProjectPositions = {
  project: { id: number; name: string; domains: string[] };
  runs: RunRef[];
  serps: SerpGroup[];
};

/** The visibility curve: one weight per SERP position, position 1 first.
 *
 *  Any positive scale works — every score is divided by the weight in play on
 *  the page being measured — so the list need not sum to anything. The running
 *  totals come from the server so there is one definition of the arithmetic. */
export type VisibilityWeights = {
  weights: number[];
  cumulative: number[];
  defaults: number[];
};

/** The same window, averaged per (keyword, domain) instead of reduced to its
 *  most recent run. */
export type ProjectAverages = {
  project: { id: number; name: string; domains: string[] };
  runs: RunRef[];
  serps: AverageSerpGroup[];
};

export type Job = {
  id: number;
  name: string;
  /** The project folder this job sits in. null = ungrouped. */
  project_id: number | null;
  keywords: string[];
  engines: string[];
  devices: string[];
  locations: LocationRef[];
  languages: string[];
  google_domains: string[];
  scrape_fields: string[];
  top_n: number;
  cron: string | null;
  schedule_enabled: boolean;
  provider: string;
  /** "serp" = SERP monitoring only. "analyzer" = + Ahrefs URL metrics. */
  mode: "serp" | "analyzer";
  /** Ahrefs batch-analysis field ids for the URL-level (exact mode) pass. */
  ahrefs_metrics: string[];
  /** Field ids for the domain-level pass. Empty = domain enrichment off. */
  ahrefs_domain_metrics: string[];
  /** Look up domain registration dates via DataForSEO WHOIS and feed the age
   *  to the AI judge. Bills dollars per request, so it is opt-in per job. */
  whois_enabled: boolean;
  /** Report the host the engine DISPLAYED (an AMP/CDN publisher) as the host
   *  that ranked. Raw hosts are stored either way and stay revealable. */
  prefer_shown_host: boolean;
  created_at: string;
  updated_at: string;
};

export type AhrefsSettings = {
  configured: boolean;
  last4: string;
  length: number;
  /** `units` is the per-row unit cost of that field. */
  metrics: { id: string; label: string; units: number }[];
  default_metrics: string[];
  default_domain_metrics: string[];
  url_only_metrics: string[];
  batch_size: number;
  base_request_units: number;
  /** How long a fetched metric may be reused across runs. 0 = cache off. */
  cache_ttl_days: number;
  cache_ttl_default: number;
  cache_ttl_max: number;
};

export type AnalysisUrl = {
  /** The URL as it ranked in the SERP. */
  url: string;
  /** The canonical URL actually sent to Ahrefs (AMP/tracking stripped). */
  analyzed_url: string;
  normalized: boolean;
  /** Best SERP slot this page reached across every engine/device/location. */
  position: number;
  /** Every slot it held — a page can rank #2 in one city and #9 in another. */
  positions: number[];
  /** Host of the canonical URL, www-stripped. Used to keep one site from
   *  taking more than one place in the weakest-competitors cohort. */
  domain: string;
  metrics: Record<string, number | null>;
  error: boolean;
  analysed: boolean;
};

export type AnalysisDomain = {
  domain: string;
  metrics: Record<string, number | null>;
  analysed: boolean;
  /** The registrable parent's own Ahrefs figures, when this host is a
   *  subdomain. Separate from `metrics` because they describe a different
   *  entity — an empty subdomain can sit on an enormous platform. */
  parent_metrics: Record<string, number | null> | null;
  /** The registration this domain's WHOIS facts belong to (eTLD+1). */
  registrable: string | null;
  /** True when `domain` sits below `registrable` — the age describes the
   *  parent registration, not this host on its own. */
  is_subdomain: boolean;
  age_days: number | null;
  created: string | null;
  registrar: string | null;
  /** False = never looked up. True with a null age = looked up, and
   *  DataForSEO's database has no record for it. */
  whois_checked: boolean;
};

export type AnalysisRow = {
  keyword: string;
  urls_total: number;
  urls_analysed: number;
  /** Every page in this keyword's SERP, ordered by position. The UI reduces
   *  this to the weakest-domain cohort at the selected depth and averages it —
   *  see lib/serp-strength. */
  urls: AnalysisUrl[];
  domains: AnalysisDomain[];
  /** Monthly search volume for the run's primary country, or the
   *  country-agnostic figure. null = never entered, which is NOT zero demand. */
  volume: number | null;
  /** Which country the volume was priced in; null = country-agnostic entry. */
  volume_country: string | null;
  volume_source: string | null;
  /** AI verdict: "low" | "medium" | "hard" | "too hard", or null. */
  difficulty: string | null;
  /** 1-3 sentence AI explanation of this SERP's nuances. */
  comment: string | null;
  /** Set when the AI call failed for this keyword. */
  ai_error: string | null;
  /** The exact text sent to the model, recorded before the call so a failed
   *  verdict still has its prompt. Null on runs made before this was stored. */
  ai_prompt: string | null;
  /** The model's own JSON reply, before parsing. */
  ai_raw: string | null;
  ai_model: string | null;
  ai_prompt_tokens: number | null;
  ai_completion_tokens: number | null;
};

export type AIAnalysisSettings = {
  prompt: string;
  is_custom: boolean;
  default: string;
  default_ru: string;
  /** Guidance shown above the domain-level table (separately editable). */
  domain_prompt: string;
  domain_is_custom: boolean;
  domain_default: string;
  domain_default_ru: string;
  provider: string | null;
  available: string[];
  /** Sampling temperature. Measured to have little effect on the verdict. */
  temperature: number;
  temperature_default: number;
  temperature_max: number;
  /** Reasoning-token allowance. 0 = thinking off. Measured to shift the
   *  verdict substantially — see the note in the settings UI. */
  thinking_budget: number;
  thinking_budget_default: number;
  thinking_budget_max: number;
  /** Answer cap. Thinking is billed against this same allowance. */
  max_output_tokens: number;
  max_output_tokens_default: number;
};

export type RunAnalysis = {
  mode: "serp" | "analyzer";
  metrics: string[];
  domain_metrics: string[];
  rows: AnalysisRow[];
  ahrefs_units: number | null;
  /** Targets served from the cross-run cache versus actually bought. Lets the
   *  unit figure be read against how much of the run was paid for. */
  ahrefs_cached: number | null;
  ahrefs_fetched: number | null;
  /** USD billed by DataForSEO for this run's WHOIS lookups. 0 when the domain
   *  cache covered everything, which is the steady state for a recurring job. */
  whois_cost: number | null;
  /** Registrable domains this run needed, cached ones included. */
  whois_domains: number | null;
  /** How many of those were actually bought rather than read from the cache. */
  whois_fetched: number | null;
  whois_enabled: boolean;
  /** The run's primary market — the country most of its results came from.
   *  Volume edits are written back against this. */
  country: string | null;
  /** Every country the run touched. More than one means the score prices
   *  demand in `country` alone and ignores the rest. */
  countries: string[];
  /** The formula this run is scored with — its override if it has one,
   *  otherwise the global. Already resolved by the server. */
  formula: OpportunityFormula;
  formula_is_override: boolean;
  formula_global: OpportunityFormula;
  formula_defaults: OpportunityFormula;
  /** True when the run targeted a city or region rather than a whole country.
   *  Keyword tools report volume per COUNTRY, so the figure is country-wide
   *  even though the SERP was measured from one city. */
  sub_national: boolean;
};

export type KeywordVolumeRow = {
  keyword: string;
  country_code: string | null;
  volume: number;
  source: string;
};

export type JobRun = {
  id: number;
  job_id: number;
  status: "pending" | "running" | "done" | "failed" | "canceled";
  started_at: string;
  finished_at: string | null;
  queries_total: number;
  queries_done: number;
  queries_failed: number;
  error: string | null;
  triggered_by: "manual" | "schedule";
  /** USD spent on this run. null on runs that predate cost tracking. */
  cost: number | null;
  /** "actual" = reported by the provider, "estimate" = queries × configured rate. */
  cost_source: "actual" | "estimate" | null;
  /** The phase most recently ENTERED. Kept after the run ends, so on a failed
   *  run it says where it stopped. null on runs that predate phase tracking. */
  phase?: RunPhase | null;
};

export type RunPhase = "scrape" | "ahrefs" | "whois" | "ai";

export type ProviderRates = {
  rates: Record<string, number>;
  defaults: Record<string, number>;
};

export type AIProviderStatus = {
  provider: string;
  fields: Record<
    string,
    { configured: boolean; last4?: string; length?: number; value?: string }
  >;
  /** Vertex only: which auth mode the stored config will actually use. */
  auth_mode: "service_account" | "express" | null;
};

export type AIProviderConfigInput = {
  api_key?: string;
  service_account_json?: string;
  project_id?: string;
  location?: string;
  model?: string;
};

export type AITestResult = {
  ok: boolean;
  model?: string;
  text?: string;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
};

export type Result = {
  id: number;
  keyword: string;
  engine: string;
  device: string;
  location: string | null;
  country_code: string | null;
  language: string | null;
  google_domain: string | null;
  position: number;
  url: string | null;
  title: string | null;
  description: string | null;
  domain: string | null;
};

export const api = {
  base: BASE,
  /** One page of jobs. `q` matches the name or any keyword. */
  listJobs: (p?: {
    q?: string; projectId?: number | null; ungrouped?: boolean;
    limit?: number; offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (p?.q?.trim()) qs.set("q", p.q.trim());
    if (p?.projectId != null) qs.set("project_id", String(p.projectId));
    if (p?.ungrouped) qs.set("ungrouped", "true");
    if (p?.limit != null) qs.set("limit", String(p.limit));
    if (p?.offset) qs.set("offset", String(p.offset));
    const tail = qs.toString();
    return req<{ items: Job[]; total: number; limit: number; offset: number }>(
      `/jobs${tail ? `?${tail}` : ""}`,
    );
  },
  listProjects: () => req<Project[]>("/projects"),
  /** Where the project's domains rank, per keyword, over a time window.
   *  `start`/`end` are ISO UTC; the window is half-open [start, end). */
  projectPositions: (id: number, range?: { start: string; end: string }) => {
    const qs = new URLSearchParams();
    if (range) { qs.set("start", range.start); qs.set("end", range.end); }
    const tail = qs.toString();
    return req<ProjectPositions>(`/projects/${id}/positions${tail ? `?${tail}` : ""}`);
  },
  /** The same window averaged per (keyword, domain) rather than reduced to the
   *  latest run. Fetched separately because it reads every run in the range,
   *  and most visits only want where things stand. */
  projectAverages: (id: number, range?: { start: string; end: string }) => {
    const qs = new URLSearchParams();
    if (range) { qs.set("start", range.start); qs.set("end", range.end); }
    const tail = qs.toString();
    return req<ProjectAverages>(
      `/projects/${id}/positions/average${tail ? `?${tail}` : ""}`,
    );
  },
  /** What each SERP slot is worth, as a share of the page, plus its running
   *  totals and the built-in curve to revert to. */
  getVisibility: () => req<VisibilityWeights>("/settings/visibility"),
  setVisibility: (weights: number[]) =>
    req<VisibilityWeights>("/settings/visibility", {
      method: "PUT",
      body: JSON.stringify({ weights }),
    }),
  resetVisibility: () =>
    req<VisibilityWeights>("/settings/visibility", { method: "DELETE" }),
  getProject: (id: number) => req<Project>(`/projects/${id}`),
  createProject: (body: { name: string; domains: string[]; notes?: string | null }) =>
    req<Project>("/projects", { method: "POST", body: JSON.stringify(body) }),
  updateProject: (
    id: number,
    body: Partial<{ name: string; domains: string[]; notes: string | null }>,
  ) => req<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteProject: (id: number) =>
    req<{ ok: boolean; jobs_ungrouped: number }>(
      `/projects/${id}`, { method: "DELETE" },
    ),
  getJob: (id: number) => req<Job>(`/jobs/${id}`),
  createJob: (body: Partial<Job>) =>
    req<Job>("/jobs", { method: "POST", body: JSON.stringify(body) }),
  updateJob: (id: number, body: Partial<Job>) =>
    req<Job>(`/jobs/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteJob: (id: number) => req(`/jobs/${id}`, { method: "DELETE" }),
  estimate: (id: number) =>
    req<{ total_queries: number; by_engine: Record<string, number> }>(`/jobs/${id}/estimate`),
  runJob: (id: number) => req<JobRun>(`/jobs/${id}/run`, { method: "POST" }),
  listRuns: (id: number) => req<JobRun[]>(`/jobs/${id}/runs`),
  getRun: (id: number) => req<JobRun>(`/runs/${id}`),
  getResults: (id: number, q?: { keyword?: string; engine?: string }) => {
    const qs = new URLSearchParams();
    if (q?.keyword) qs.set("keyword", q.keyword);
    if (q?.engine) qs.set("engine", q.engine);
    const tail = qs.toString();
    return req<Result[]>(`/runs/${id}/results${tail ? `?${tail}` : ""}`);
  },
  listKeywordVolumes: (keywords?: string[], country?: string | null) => {
    const qs = new URLSearchParams();
    if (keywords?.length) qs.set("keywords", keywords.join(","));
    if (country) qs.set("country", country);
    const tail = qs.toString();
    return req<KeywordVolumeRow[]>(`/keyword-volumes${tail ? `?${tail}` : ""}`);
  },
  saveKeywordVolumes: (items: { keyword: string; country_code: string | null; volume: number }[]) =>
    req<KeywordVolumeRow[]>("/keyword-volumes", {
      method: "PUT", body: JSON.stringify(items),
    }),
  setAITuning: (body: {
    temperature: number | null;
    thinking_budget: number | null;
    max_output_tokens: number | null;
  }) =>
    req<{ temperature: number; thinking_budget: number; max_output_tokens: number }>(
      "/settings/ai-analysis/tuning", { method: "PUT", body: JSON.stringify(body) },
    ),
  setAhrefsCacheTtl: (days: number | null) =>
    req<{ cache_ttl_days: number }>("/settings/ahrefs/cache-ttl", {
      method: "PUT", body: JSON.stringify({ days }),
    }),
  clearAhrefsCache: () =>
    req<{ cleared: number }>("/settings/ahrefs/cache", { method: "DELETE" }),
  getOpportunityFormula: () =>
    req<{ formula: OpportunityFormula; defaults: OpportunityFormula }>("/settings/opportunity"),
  saveOpportunityFormula: (formula: Partial<OpportunityFormula>) =>
    req<{ formula: OpportunityFormula; defaults: OpportunityFormula }>("/settings/opportunity", {
      method: "PUT", body: JSON.stringify(formula),
    }),
  resetOpportunityFormula: () =>
    req<{ formula: OpportunityFormula; defaults: OpportunityFormula }>("/settings/opportunity", {
      method: "DELETE",
    }),
  setRunFormula: (runId: number, formula: Partial<OpportunityFormula>) =>
    req<{ formula: OpportunityFormula; formula_is_override: boolean }>(
      `/runs/${runId}/opportunity`, { method: "PUT", body: JSON.stringify(formula) },
    ),
  clearRunFormula: (runId: number) =>
    req<{ formula: OpportunityFormula; formula_is_override: boolean }>(
      `/runs/${runId}/opportunity`, { method: "DELETE" },
    ),
  exportUrl: (id: number, top: number) =>
    `${BASE}/runs/${id}/export.csv?top=${top}`,
  searchLocations: (q: string) =>
    req<LocationRef[]>(`/lookup/locations?q=${encodeURIComponent(q)}`),
  listLanguages: () => req<{ code: string; name: string }[]>("/lookup/languages"),
  listGoogleDomains: () => req<{ domain: string; country: string }[]>("/lookup/google-domains"),

  // Saved (manual) locations
  listSavedLocations: (q?: string) => {
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    return req<SavedLocation[]>(`/lookup/saved-locations${qs}`);
  },
  createSavedLocation: (body: SavedLocationInput) =>
    req<SavedLocation>("/lookup/saved-locations", { method: "POST", body: JSON.stringify(body) }),
  updateSavedLocation: (id: number, body: SavedLocationInput) =>
    req<SavedLocation>(`/lookup/saved-locations/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteSavedLocation: (id: number) =>
    req(`/lookup/saved-locations/${id}`, { method: "DELETE" }),
  importSavedLocations: (items: SavedLocationInput[]) =>
    req<{ added: number; skipped: number }>("/lookup/saved-locations/import", {
      method: "POST", body: JSON.stringify({ items }),
    }),

  // SerpAPI key (runtime settings)
  getApiKeyStatus: () =>
    req<ApiKeyStatus>("/settings/api-key"),
  setApiKey: (api_key: string) =>
    req<ApiKeyStatus>("/settings/api-key", { method: "PUT", body: JSON.stringify({ api_key }) }),
  clearApiKey: () =>
    req<ApiKeyStatus>("/settings/api-key", { method: "DELETE" }),
  testApiKey: () =>
    req<ApiKeyTestResult>("/settings/api-key/test", { method: "POST" }),

  // Scheduler
  getScheduleInfo: (jobId: number) =>
    req<ScheduleInfo>(`/jobs/${jobId}/schedule-info`),
  getSchedulerStatus: () =>
    req<{ timezone: string }>("/settings/scheduler"),

  getAnalysis: (runId: number) => req<RunAnalysis>(`/runs/${runId}/analysis`),
  /** Re-issue the queries a run never got results for, then top up the
   *  analyzer phases for whatever those queries add. */
  retryRun: (runId: number) =>
    req<{ missing: number; started: boolean }>(
      `/runs/${runId}/retry`, { method: "POST" },
    ),
  /** Re-enter the AI phase for a run that already holds its SERP and metrics.
   *  Only keywords without a verdict are judged, so the cost is tokens for
   *  what is actually missing. Returns the counts before the work starts. */
  rescoreAi: (runId: number) =>
    req<{ keywords: number; judged: number; pending: number }>(
      `/runs/${runId}/ai`, { method: "POST" },
    ),

  // AI SERP-difficulty prompt + provider choice
  getAIAnalysisSettings: () => req<AIAnalysisSettings>("/settings/ai-analysis"),
  setAIPrompt: (prompt: string | null) =>
    req<AIAnalysisSettings>("/settings/ai-analysis/prompt", {
      method: "PUT", body: JSON.stringify({ prompt }),
    }),
  setAIDomainPrompt: (prompt: string | null) =>
    req<AIAnalysisSettings>("/settings/ai-analysis/domain-prompt", {
      method: "PUT", body: JSON.stringify({ prompt }),
    }),
  setAIAnalysisProvider: (provider: string | null) =>
    req<{ provider: string | null }>("/settings/ai-analysis/provider", {
      method: "PUT", body: JSON.stringify({ provider }),
    }),

  // Ahrefs (analyzer mode)
  getAhrefs: () => req<AhrefsSettings>("/settings/ahrefs"),
  setAhrefsKey: (api_key: string) =>
    req<AhrefsSettings>("/settings/ahrefs", {
      method: "PUT", body: JSON.stringify({ api_key }),
    }),
  clearAhrefsKey: () => req("/settings/ahrefs", { method: "DELETE" }),
  testAhrefs: () =>
    req<{ ok: boolean; units_billed?: number; sample_dr?: number | null }>(
      "/settings/ahrefs/test", { method: "POST" }
    ),

  // AI providers (Gemini via Google AI Studio / Vertex AI)
  listAIProviders: () => req<AIProviderStatus[]>("/settings/ai-providers"),
  setAIProviderConfig: (provider: string, body: AIProviderConfigInput) =>
    req<AIProviderStatus>(`/settings/ai-providers/${provider}`, {
      method: "PUT", body: JSON.stringify(body),
    }),
  clearAIProviderConfig: (provider: string) =>
    req<AIProviderStatus>(`/settings/ai-providers/${provider}`, { method: "DELETE" }),
  testAIProvider: (provider: string) =>
    req<AITestResult>(`/settings/ai-providers/${provider}/test`, { method: "POST" }),

  // Per-provider cost rates ($/search)
  getRates: () => req<ProviderRates>("/settings/rates"),
  setRates: (rates: Record<string, number | string | null>) =>
    req<ProviderRates>("/settings/rates", {
      method: "PUT", body: JSON.stringify({ rates }),
    }),

  // Provider credentials (Bright Data, Oxylabs, SerpAPI)
  listProviderStatuses: () =>
    req<ProviderStatus[]>("/settings/providers"),
  getProviderStatus: (provider: string) =>
    req<ProviderStatus>(`/settings/providers/${provider}`),
  setProviderCreds: (provider: string, body: Partial<ProviderCredsInput>) =>
    req<ProviderStatus>(`/settings/providers/${provider}`, {
      method: "PUT", body: JSON.stringify(body),
    }),
  clearProviderCreds: (provider: string) =>
    req<ProviderStatus>(`/settings/providers/${provider}`, { method: "DELETE" }),
  testProvider: (provider: string) =>
    req<Record<string, any>>(`/settings/providers/${provider}/test`, { method: "POST" }),
};

export type ProviderStatus = {
  provider: string;
  fields: Record<string, { configured: boolean; last4?: string; length?: number; value?: string }>;
};

export type ProviderCredsInput = {
  api_key?: string;
  token?: string;
  zone?: string;
  zone_raw?: string;
  username?: string;
  password?: string;
  login?: string; // DataForSEO
};

export type ScheduleInfo = {
  registered: boolean;
  next_run_time: string | null;
  timezone: string;
};

export type ApiKeyStatus = {
  source: "db" | "env" | "none";
  configured: boolean;
  last4: string;
  length: number;
};
export type ApiKeyTestResult = {
  ok: boolean;
  plan?: string | null;
  searches_left?: number | null;
  this_month?: number | null;
};

export type SavedLocationInput = {
  canonical_name: string;
  name?: string | null;
  country_code?: string | null;
  target_type?: string | null;
  yandex_lr?: number | null;
  notes?: string | null;
};

export type SavedLocation = SavedLocationInput & { id: number };
