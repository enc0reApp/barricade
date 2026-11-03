/**
 * A deterministic pixel starfield as a CSS box-shadow list — paint it on a
 * 2–3px square element and every shadow is one star. Pure.
 */

import { seeded } from "./rng";

const COLORS = ["241,238,232", "241,238,232", "241,238,232", "69,229,255", "255,181,71"];

export function starfieldShadow(opts: { seed: number; count: number; width: number; height: number; grid?: number }): string {
  const { seed, count, width, height, grid = 3 } = opts;
  const r = seeded(seed);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = Math.floor((r() * width) / grid) * grid;
    const y = Math.floor((r() * height) / grid) * grid;
    const big = r() > 0.92;
    const a = (0.2 + r() * 0.6).toFixed(2);
    const c = COLORS[Math.floor(r() * COLORS.length)] ?? COLORS[0]!;
    out.push(`${x}px ${y}px 0 ${big ? 1 : 0}px rgba(${c},${a})`);
  }
  return out.join(", ");
}
