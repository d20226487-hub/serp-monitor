/**
 * When a host was the AMP domain of its site, as the tables show it (user,
 * 2026-10-14: "give the date when the domain was AMP for the main domain
 * inside the overview, block, and position tables").
 *
 * The days are the ones the AMP Rotator NAMED it on — the rotator says which
 * host is current, never since when — so "since 13.10" means "named since
 * 13.10", and it may have been the AMP domain before.
 */
export type AmpPeriod = {
  /** The first time a rotator named it for its site. */
  from: string | null;
  /** The last time; null while the latest answer still names it. */
  to: string | null;
};

/** Server times are UTC without saying so; read as local they are hours off. */
export function ampDay(iso: string): string {
  const at = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return at.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
}

/** "since 13.10" while it still is; "12.10–13.10" once the rotator has moved
 *  on; "13.10" for a single day. null when nothing is known. */
export function ampPeriodText(
  period: AmpPeriod | null | undefined,
  since: (day: string) => string,
): string | null {
  if (!period?.from) return null;
  const from = ampDay(period.from);
  if (period.to === null) return since(from);
  const to = ampDay(period.to);
  return from === to ? from : `${from}–${to}`;
}
