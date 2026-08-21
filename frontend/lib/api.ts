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

export type Job = {
  id: number;
  name: string;
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
};

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
  listJobs: () => req<Job[]>("/jobs"),
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
