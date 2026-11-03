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
