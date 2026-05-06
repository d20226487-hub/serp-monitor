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
  created_at: string;
  updated_at: string;
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
