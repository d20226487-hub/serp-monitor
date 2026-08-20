// Shared money formatting for the cost displays (job form estimate, run page,
// job page total).

/**
 * Format a USD amount for display.
 *
 * Per-search rates run to fractions of a cent, so a fixed 2-decimal format
 * would render most single runs as "$0.00" and look broken. We widen the
 * precision for small amounts instead, and keep normal currency formatting
 * once the number is big enough to read.
 */
export function formatUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

/**
 * How many billable units one search costs at a given result depth.
 *
 * DataForSEO bills "per each SERP containing up to 10 results", so asking for
 * top_n=30 is charged as 3 SERPs, and top_n=100 as 10. The other providers bill
 * per request regardless of how many results come back.
 *
 * The clamp mirrors the backend (`min(max(top_n, 10), 100)`) so the estimate
 * matches what we actually request.
 */
export function billingUnits(provider: string, topN: number): number {
  if (provider !== "dataforseo") return 1;
  const depth = Math.min(Math.max(topN || 10, 10), 100);
  return Math.ceil(depth / 10);
}

/** Sum the cost of many runs, ignoring runs with no recorded cost. */
export function sumCost(runs: { cost: number | null }[]): number {
  return runs.reduce((acc, r) => acc + (r.cost ?? 0), 0);
}

/** True when at least one run has a cost recorded — lets callers hide the
 * total entirely rather than showing a misleading "$0" for legacy data. */
export function hasAnyCost(runs: { cost: number | null }[]): boolean {
  return runs.some((r) => r.cost != null);
}
