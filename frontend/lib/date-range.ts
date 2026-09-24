// The time window the positions table is read through.
//
// Every preset is computed in the VIEWER'S timezone and then sent as UTC,
// because "today" is a claim about the wall clock in front of you, not about
// UTC. A run at 02:00 Almaty time is the previous UTC day; picking "Today" and
// not seeing it would be wrong in the only way that matters here.
//
// Ranges are half-open [start, end): the end of "today" is the first instant of
// tomorrow. That makes consecutive presets abut exactly, with no run able to
// fall in both or in neither.

export type RangePreset =
  | "today" | "yesterday" | "week" | "month" | "year" | "custom";

export const RANGE_PRESETS: RangePreset[] = [
  "today", "yesterday", "week", "month", "year", "custom",
];

export type DateRange = {
  /** Inclusive. */
  start: Date;
  /** Exclusive. */
  end: Date;
};

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/**
 * Monday, not Sunday: this is used across CIS markets, where the week starts on
 * Monday and a Sunday-based "this week" would put yesterday in last week for
 * most of it.
 */
function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  // getDay(): 0 = Sunday. Monday-based offset makes Sunday 6 days in.
  const offset = (day.getDay() + 6) % 7;
  return addDays(day, -offset);
}

export function rangeFor(preset: RangePreset, now: Date = new Date()): DateRange {
  const today = startOfDay(now);
  switch (preset) {
    case "today":
      return { start: today, end: addDays(today, 1) };
    case "yesterday":
      return { start: addDays(today, -1), end: today };
    case "week":
      // Calendar week to date, not a rolling seven days — "this week" is what
      // was asked for, and a rolling window would move under the reader.
      return { start: startOfWeek(now), end: addDays(today, 1) };
    case "month":
      return {
        start: new Date(today.getFullYear(), today.getMonth(), 1),
        end: addDays(today, 1),
      };
    case "year":
      // Calendar year to date, matching week and month: these presets all end
      // at the end of today rather than running a rolling window backwards.
      return {
        start: new Date(today.getFullYear(), 0, 1),
        end: addDays(today, 1),
      };
    case "custom":
      // Custom carries its own dates; this is only the fallback shape.
      return { start: today, end: addDays(today, 1) };
  }
}

/** A custom range from two `<input type="date">` values, end inclusive.
 *  Returns null while the pair is incomplete or backwards, so a half-typed
 *  range never fires a query for a window nobody asked for. */
export function customRange(fromValue: string, toValue: string): DateRange | null {
  if (!fromValue || !toValue) return null;
  const [fy, fm, fd] = fromValue.split("-").map(Number);
  const [ty, tm, td] = toValue.split("-").map(Number);
  if (!fy || !ty) return null;
  const start = new Date(fy, fm - 1, fd);
  // The picker's "to" day is one the reader means to include, so the exclusive
  // end is the day after it.
  const end = addDays(new Date(ty, tm - 1, td), 1);
  if (!(start < end)) return null;
  return { start, end };
}

/** Query-string form: UTC, which is what run timestamps are stored in. */
export function toQuery(range: DateRange): { start: string; end: string } {
  return { start: range.start.toISOString(), end: range.end.toISOString() };
}

/** `<input type="date">` form of a local date. toISOString would shift the day
 *  for anyone east or west of UTC, which is how a date picker ends up one day
 *  off. */
export function toInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
