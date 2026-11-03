/**
 * Just enough CSS reading for layout/a11y regression tests: flat rule blocks,
 * with the @media they sit in. Not a general parser (no nesting beyond one
 * at-rule level, no strings containing braces).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Rule {
  media: string | null;
  selectors: string[];
  decls: Map<string, string>;
}

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export function readCss(rel: string): string {
  return readFileSync(ROOT + rel, "utf8");
}

export function parseCss(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  let i = 0;
  const walk = (end: number, media: string | null) => {
    while (i < end) {
      const open = src.indexOf("{", i);
      if (open < 0 || open >= end) return;
      const head = src.slice(i, open).trim();
      if (head.startsWith("@")) {
        // find the matching close brace of the at-rule
        let depth = 1;
        let j = open + 1;
        while (j < src.length && depth > 0) {
          if (src[j] === "{") depth++;
          else if (src[j] === "}") depth--;
          j++;
        }
        i = open + 1;
        if (head.startsWith("@media") || head.startsWith("@container") || head.startsWith("@supports")) walk(j - 1, head);
        i = j;
        continue;
      }
      const close = src.indexOf("}", open);
      const body = src.slice(open + 1, close);
      const decls = new Map<string, string>();
      for (const part of body.split(";")) {
        const c = part.indexOf(":");
        if (c < 0) continue;
        const prop = part.slice(0, c).trim();
        const value = part.slice(c + 1).trim().replace(/\s+/g, " ");
        if (prop) decls.set(prop, value);
      }
      out.push({ media, selectors: head.split(",").map((s) => s.trim().replace(/\s+/g, " ")), decls });
      i = close + 1;
    }
  };
  walk(src.length, null);
  return out;
}

/** Declarations for an exact selector, merged in source order (later wins), optionally only inside a given @media prelude substring. */
export function declsFor(css: string, selector: string, media: string | null = null): Map<string, string> {
  const merged = new Map<string, string>();
  for (const r of parseCss(css)) {
    if (!r.selectors.includes(selector)) continue;
    if (media === null ? r.media !== null : !(r.media ?? "").includes(media)) continue;
    for (const [k, v] of r.decls) merged.set(k, v);
  }
  return merged;
}

/* ───── WCAG contrast ───── */

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  return [0, 2, 4].map((o) => parseInt(full.slice(o, o + 2), 16)) as [number, number, number];
}

export function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `fg` at `alpha` composited over `bg`. */
export function over(fg: [number, number, number], alpha: number, bg: [number, number, number]): [number, number, number] {
  return fg.map((c, i) => Math.round(alpha * c + (1 - alpha) * bg[i]!)) as [number, number, number];
}
