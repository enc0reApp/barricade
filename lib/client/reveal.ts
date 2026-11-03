/**
 * Crowd-surf reveal maths. Pure.
 *
 * The reveal track runs from 0 (the plaque is held up at the back) to 100
 * (the deepest tier). Tier lines sit at their points value, so the spacing is
 * proportional to points: 10, 15, 30, 60, 85, 100.
 *
 * The plaque does not move at a constant speed. It eases in, hesitates at
 * every tier line it reaches ("is it going further?"), then decelerates into
 * its final line. We get that by defining a speed field v(x) over the track,
 * integrating dt = dx / v(x) into a time table, and inverting it.
 */

import { TIER_IDS, TIERS, type Outcome, type TierId } from "../game/tiers";

export const TRACK_MAX = 100;

export interface TierLine {
  id: TierId;
  points: number;
}

/** Tier lines from the bottom of the track (fewest points) to the top. */
export function tierLines(): TierLine[] {
  return TIER_IDS.map((id) => ({ id, points: TIERS[id].points })).sort((a, b) => a.points - b.points);
}

/** 1.6s for MAIN STAGE up to 2.6s for YOU HAD TO BE THERE. */
export function revealDuration(points: number): number {
  const u = clamp01((points - 10) / 90);
  return Math.round(1600 + 1000 * u);
}

/** Track position for an outcome (a miss never leaves the back). */
export function targetFor(outcome: Outcome): number {
  return outcome === "miss" ? 0 : TIERS[outcome].points;
}

export interface RevealCurve {
  /** Position on the track (0..target) at normalised time t (0..1). */
  at(t: number): number;
  target: number;
}

const SAMPLES = 480;

/**
 * Builds the position-over-time curve for a plaque travelling to `target`.
 * `lines` are the track values that cause a hesitation (defaults to all tier lines).
 */
export function buildRevealCurve(target: number, lines: readonly number[] = tierLines().map((l) => l.points)): RevealCurve {
  if (!(target > 0)) return { at: () => 0, target: 0 };
  const relevant = lines.filter((l) => l > 0 && l <= target);
  const width = 2.4; // track units of hesitation either side of a line

  const speed = (x: number): number => {
    const u = x / target;
    // Lift-off: the hands take a beat to get it moving.
    const lift = 0.3 + 0.7 * smoothstep(0, 0.1, u);
    // Final approach: slows right down into its line.
    const settle = 0.08 + 0.92 * Math.pow(1 - u, 1.25);
    let hesitate = 1;
    for (const l of relevant) {
      if (l === target) continue; // the settle already handles the last line
      const d = (x - l) / width;
      hesitate *= 1 - 0.72 * Math.exp(-d * d);
    }
    return Math.max(0.02, lift * settle * hesitate);
  };

  // Cumulative time table, trapezoidal rule over equal position steps.
  const xs = new Float64Array(SAMPLES + 1);
  const ts = new Float64Array(SAMPLES + 1);
  const dx = target / SAMPLES;
  let prevInv = 1 / speed(0);
  for (let k = 1; k <= SAMPLES; k++) {
    const x = k * dx;
    const inv = 1 / speed(x);
    xs[k] = x;
    ts[k] = ts[k - 1]! + ((prevInv + inv) / 2) * dx;
    prevInv = inv;
  }
  const total = ts[SAMPLES]!;
  for (let k = 0; k <= SAMPLES; k++) ts[k] = ts[k]! / total;

  return {
    target,
    at(t: number): number {
      if (t <= 0) return 0;
      if (t >= 1) return target;
      let lo = 0;
      let hi = SAMPLES;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (ts[mid]! <= t) lo = mid;
        else hi = mid;
      }
      const t0 = ts[lo]!;
      const t1 = ts[hi]!;
      const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
      return xs[lo]! + (xs[hi]! - xs[lo]!) * f;
    },
  };
}

/**
 * Pushes label positions apart so none overlap, keeping each as close to its
 * line as possible. Positions are pixels from the bottom; returns new positions
 * in the same order. MAIN STAGE (10) and TOTE BAG (15) sit close together.
 */
export function spreadLabels(positions: readonly number[], minGap: number): number[] {
  const order = positions.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const placed = order.map((o) => o.p);
  for (let k = 1; k < placed.length; k++) {
    if (placed[k]! - placed[k - 1]! < minGap) placed[k] = placed[k - 1]! + minGap;
  }
  // If we pushed past the top, walk back down.
  const top = Math.max(...positions);
  const overflow = placed[placed.length - 1]! - top;
  if (overflow > 0) {
    placed[placed.length - 1] = top;
    for (let k = placed.length - 2; k >= 0; k--) {
      if (placed[k + 1]! - placed[k]! < minGap) placed[k] = placed[k + 1]! - minGap;
    }
  }
  const out = new Array<number>(positions.length);
  order.forEach((o, k) => {
    out[o.i] = placed[k]!;
  });
  return out;
}

/** Counts a number from `from` to `to` with an ease-out over `duration` ms. */
export function countAt(from: number, to: number, elapsed: number, duration: number): number {
  if (duration <= 0 || elapsed >= duration) return to;
  const u = clamp01(elapsed / duration);
  const eased = 1 - Math.pow(1 - u, 3);
  return Math.round(from + (to - from) * eased);
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function smoothstep(a: number, b: number, x: number): number {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
}
