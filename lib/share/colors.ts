/**
 * Hex colours for renderers that cannot read CSS custom properties
 * (next/og ImageResponse, canvas). Mirrors app/tokens.css — keep in sync.
 */

import type { Outcome, TierId } from "../game/tiers";

export const PAPER = "#F5EDDA";
export const PAPER_SHADE = "#E3D9C5";
export const INK = "#0B0D17";
export const INK_SOFT = "#4A4E63";

export const NIGHT = {
  sky0: "#151618",
  sky1: "#1c1d22",
  sky2: "#292b38",
  sky3: "#343be8",
  field0: "#1a1b20",
  field1: "#25262d",
  panel: "#24252b",
  panelEdge: "#474952",
  ink: "#f5edda",
  inkDim: "#c4c0b9",
  inkFaint: "#85878e",
  cyan: "#d6ff62",
  magenta: "#ff805c",
  amber: "#ffca6b",
  uv: "#9b8bff",
} as const;

export const TIER_HEX: Record<TierId, string> = {
  main: "#f5edda",
  tote: "#e8ac79",
  side: "#80aaff",
  tent: "#b4e889",
  basement: "#b7a5ff",
  htbt: "#ffe16c",
};

export const MISS_HEX = "#43454d";

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
