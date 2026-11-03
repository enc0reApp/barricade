/**
 * Calendar maths. Isomorphic (client + server).
 *
 * A set belongs to a calendar DATE (YYYY-MM-DD), not an instant. Players get
 * the set for their own local date, like Wordle. At any instant the dates that
 * are "live" somewhere on Earth span UTC-12 … UTC+14.
 */

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** The player's local calendar date. */
export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function utcDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return utcDateString(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** Puzzle number for a date (epoch = #1). < 1 means before launch. */
export function numberForDate(epoch: string, date: string): number {
  return daysBetween(epoch, date) + 1;
}

export function dateForNumber(epoch: string, number: number): string {
  return addDays(epoch, number - 1);
}

/** Earliest and latest local dates that exist anywhere right now. */
export function liveDateWindow(nowMs: number): { earliest: string; latest: string } {
  return {
    earliest: utcDateString(nowMs - 12 * 3_600_000),
    latest: utcDateString(nowMs + 14 * 3_600_000),
  };
}

/** True when `date` is today for someone on Earth right now (scored play). */
export function isLiveDate(date: string, nowMs: number): boolean {
  const { earliest, latest } = liveDateWindow(nowMs);
  return date >= earliest && date <= latest;
}

/** True when nobody can still be playing `date` (safe to publish its answers / crowd stats). */
export function isClosedDate(date: string, nowMs: number): boolean {
  return date < liveDateWindow(nowMs).earliest;
}

/** Milliseconds until the player's next local midnight ("doors open in …"). */
export function msUntilLocalMidnight(d: Date = new Date()): number {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return next.getTime() - d.getTime();
}
