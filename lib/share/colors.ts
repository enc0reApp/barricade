/**
 * Hex colours for renderers that cannot read CSS custom properties
 * (next/og ImageResponse, canvas). Mirrors app/tokens.css — keep in sync.
 */

import type { Outcome, TierId } from "../game/tiers";

export const PAPER = "#F1EEE8";
export const PAPER_SHADE = "#E2DDD3";
export const INK = "#0B0D17";
export const INK_SOFT = "#4A4E63";

export const NIGHT = {
  sky0: "#05060d",
  sky1: "#0a0e22",
  sky2: "#141a3d",
  sky3: "#232a5c",
  field0: "#090c18",
  field1: "#0f1426",
  panel: "#0c1124",
  panelEdge: "#273160",
  ink: "#f1eee8",
  inkDim: "#9aa1c2",
  inkFaint: "#5a6290",
  cyan: "#45e5ff",
  magenta: "#ff4fa3",
  amber: "#ffb547",
  uv: "#8b5cff",
} as const;

export const TIER_HEX: Record<TierId, string> = {
  main: "#e8e6e3",
  tote: "#d9a066",
  side: "#4da3ff",
  tent: "#3ddc84",
  basement: "#b26bff",
  htbt: "#ffd447",
};

export const MISS_HEX = "#2a3150";

export function outcomeHex(o: Outcome): string {
  return o === "miss" ? MISS_HEX : TIER_HEX[o];
}

/** Linear mix of two #rrggbb colours, t in 0..1. Returns #rrggbb. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const k = Math.min(1, Math.max(0, t));
  const out = pa.map((v, i) => Math.round(v + ((pb[i] ?? v) - v) * k));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
