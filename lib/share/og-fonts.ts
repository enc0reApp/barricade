/**
 * TTF fonts for next/og ImageResponse (satori can't read woff2).
 * Server-only. Files live in assets/fonts/ and are traced into the
 * serverless bundle by next.config.ts (outputFileTracingIncludes).
 *
 *   new ImageResponse(el, { ...size, fonts: await loadOgFonts(["pixel", "mono"]) })
 *   <div style={{ fontFamily: OG_FONT.pixel }}>BARRICADE</div>
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

/** fontFamily names to use in satori styles. */
export const OG_FONT = {
  pixel: "Geist Pixel Square",
  pixelLine: "Geist Pixel Line",
  pixelGrid: "Geist Pixel Grid",
  pixelCircle: "Geist Pixel Circle",
  pixelTriangle: "Geist Pixel Triangle",
  mono: "Geist Mono",
} as const;

export type OgFontKey = "pixel" | "pixelLine" | "pixelGrid" | "pixelCircle" | "pixelTriangle" | "mono" | "monoMedium";

export interface OgFont {
  name: string;
  data: Buffer;
  weight: 400 | 500;
  style: "normal";
}

const FILES: Record<OgFontKey, { name: string; file: string; weight: 400 | 500 }> = {
  pixel: { name: OG_FONT.pixel, file: "GeistPixel-Square.ttf", weight: 400 },
  pixelLine: { name: OG_FONT.pixelLine, file: "GeistPixel-Line.ttf", weight: 400 },
  pixelGrid: { name: OG_FONT.pixelGrid, file: "GeistPixel-Grid.ttf", weight: 400 },
  pixelCircle: { name: OG_FONT.pixelCircle, file: "GeistPixel-Circle.ttf", weight: 400 },
  pixelTriangle: { name: OG_FONT.pixelTriangle, file: "GeistPixel-Triangle.ttf", weight: 400 },
  mono: { name: OG_FONT.mono, file: "GeistMono-Regular.ttf", weight: 400 },
  monoMedium: { name: OG_FONT.mono, file: "GeistMono-Medium.ttf", weight: 500 },
};

/** Module-scope cache: each file is read once per server instance. */
const cache = new Map<OgFontKey, Promise<OgFont>>();

function loadOne(key: OgFontKey): Promise<OgFont> {
  let p = cache.get(key);
  if (!p) {
    const { name, file, weight } = FILES[key];
    p = readFile(path.join(process.cwd(), "assets/fonts", file)).then((data) => ({
      name,
      data,
      weight,
      style: "normal" as const,
    }));
    // Don't cache a failure forever (e.g. a cold start racing a deploy).
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export const DEFAULT_OG_FONTS: readonly OgFontKey[] = ["pixel", "pixelLine", "mono", "monoMedium"];

export function loadOgFonts(keys: readonly OgFontKey[] = DEFAULT_OG_FONTS): Promise<OgFont[]> {
  return Promise.all([...new Set(keys)].map(loadOne));
}
