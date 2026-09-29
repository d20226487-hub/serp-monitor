// The SERP providers as the UI needs to know them: display names, and which
// engines each can run. The engine map mirrors the backend's
// `SerpProvider.engines` (backend/app/providers) — change them together, or
// the job form will price queries the runner never sends.

export const PROVIDER_IDS = ["serpapi", "brightdata", "oxylabs", "dataforseo"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

const LABELS: Record<string, string> = {
  serpapi: "SerpAPI",
  brightdata: "Bright Data",
  oxylabs: "Oxylabs",
  dataforseo: "DataForSEO",
};

// DataForSEO's SERP API has no Yandex endpoint at all.
const ENGINES: Record<string, readonly string[]> = {
  serpapi: ["google", "yandex"],
  brightdata: ["google", "yandex"],
  oxylabs: ["google", "yandex"],
  dataforseo: ["google"],
};

export function providerLabel(id: string | null | undefined): string {
  if (!id) return "—";
  return LABELS[id] ?? id;
}

export function providerSupports(id: string, engine: string): boolean {
  return (ENGINES[id] ?? []).includes(engine);
}
