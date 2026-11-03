/**
 * Display formatting. Pure and isomorphic.
 */

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

/** "2026-11-09" → "MON 09 NOV". Calendar maths in UTC so the date never shifts. */
export function formatSetDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return `${DAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]}`;
}

/** "2026-11-09" → "MON 09 NOV 2026". */
export function formatSetDateLong(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return `${formatSetDate(date)} ${d.getUTCFullYear()}`;
}

/** Milliseconds → "06:12:33". Never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const clock = [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  // More than a day away (e.g. the pre-launch countdown): "5D 11:30:39".
  return d > 0 ? `${d}D ${clock}` : clock;
}

/** Estimated share (0..1) → "≈0.3%". */
export function formatShare(share: number): string {
  const n = formatPercentNumber(share * 100);
  return n.startsWith("<") ? `${n}%` : `≈${n}%`;
}

/** A percentage that is already 0..100 → "0.6" / "12" / "<0.1". */
export function formatPercentNumber(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return "0";
  if (pct < 0.1) return "<0.1";
  if (pct < 10) return (Math.round(pct * 10) / 10).toString();
  return String(Math.round(pct));
}

export function formatCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function formatMetres(m: number): string {
  return `${Math.max(0, Math.round(m))}m`;
}

/** Turns a canonical name into the uppercase plaque text, keeping it short enough for a phone. */
export function plaqueText(name: string, max = 28): string {
  const up = name.toUpperCase();
  return up.length > max ? `${up.slice(0, max - 1)}…` : up;
}
