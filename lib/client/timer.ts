/**
 * Round-clock maths. The server owns the clock: a round's deadline is in
 * server time, so the client keeps an offset measured when the round started.
 *
 *   offset    = serverNow − Date.now()          (at round start)
 *   remaining = deadline − (Date.now() + offset)
 */

export function clockOffset(serverNow: number, clientNow: number): number {
  return serverNow - clientNow;
}

/** Milliseconds left on the round clock, never negative. */
export function remainingMs(deadline: number, offset: number, clientNow: number): number {
  return Math.max(0, deadline - (clientNow + offset));
}

/** Whole seconds shown on the clock: 24.01s → 25, 0.2s → 1, 0 → 0. */
export function displaySeconds(ms: number): number {
  return Math.max(0, Math.ceil(ms / 1000));
}

export type VuLevel = "ok" | "warn" | "danger";

/** Green, then amber from 10s, then red from 5s (static, never flashing). */
export function vuLevel(secondsLeft: number): VuLevel {
  if (secondsLeft <= 5) return "danger";
  if (secondsLeft <= 10) return "warn";
  return "ok";
}

/** How many of `total` one-second segments are still lit. */
export function litSegments(total: number, ms: number): number {
  return Math.min(total, displaySeconds(ms));
}

/** True when the round's clock has run out (from the client's corrected view). */
export function isExpired(deadline: number, offset: number, clientNow: number): boolean {
  return remainingMs(deadline, offset, clientNow) <= 0;
}

/* ───────────────────────────── calendar clocks ───────────────────────────── */

/** Epoch ms of the local midnight that ends `date` (YYYY-MM-DD): when the next night's doors open. */
export function localMidnightAfter(date: string): number {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime();
}

/** The next scheduled local midnight; null means the current bill has ended. */
export function nextSetOpensAt(date: string, nextDate?: string | null): number | null {
  if (nextDate === null) return null;
  if (nextDate === undefined) return localMidnightAfter(date); // older server / saved games
  const [y = 1970, m = 1, d = 1] = nextDate.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** Epoch ms of the next local midnight after `nowMs`. */
export function nextLocalMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
}

/**
 * The fixed instant a countdown runs to: `target`, or the next local midnight
 * as of `nowMs`. Fix it once when the countdown starts — re-measuring "next
 * midnight" on every tick never reaches zero.
 */
export function countdownEnd(target: number | undefined, nowMs: number): number {
  return target ?? nextLocalMidnight(nowMs);
}

/* ───────────────────────────── the morning after ───────────────────────────── */

/** Longest single wait before re-checking a not-yet crowd page. */
export const CROWD_MAX_WAIT_MS = 60 * 60_000;
/** Extra wait after opensAt, so the request lands after the server's boundary. */
export const CROWD_OPEN_PAD_MS = 500;

/**
 * `opensAt` (server clock) in client-clock ms. Uses the response's `serverNow`
 * when the server sends one; otherwise trusts the device clock.
 */
export function crowdOpensAtLocal(res: { opensAt: number; serverNow?: unknown }, receivedAt: number): number {
  return typeof res.serverNow === "number" && Number.isFinite(res.serverNow)
    ? res.opensAt - clockOffset(res.serverNow, receivedAt)
    : res.opensAt;
}

/**
 * When to ask /api/crowd again after a not-yet: at opensAt (+ a pad), and if
 * that has already passed (device clock ahead of the server), back off
 * 1s, 2s, 4s … 60s instead of refetching in a loop. `retries` = not-yets in a row
 * that arrived after opensAt had passed.
 */
export function crowdRetryDelay(opensAtLocal: number, clientNow: number, retries: number): number {
  const left = opensAtLocal - clientNow;
  if (left > 0) return Math.min(CROWD_MAX_WAIT_MS, left + CROWD_OPEN_PAD_MS);
  return Math.min(60_000, 1000 * 2 ** Math.max(0, retries));
}
