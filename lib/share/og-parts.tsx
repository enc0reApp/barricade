/**
 * Small satori-safe building blocks for the OG images (flexbox + absolute
 * boxes only). Server-only by convention; no Node APIs used here.
 */

import type { CSSProperties, ReactElement } from "react";

import { seeded } from "./rng";

export { seeded };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An absolutely positioned box. */
export function Box({ x, y, w, h, style }: Rect & { style?: CSSProperties }): ReactElement {
  return <div style={{ position: "absolute", left: x, top: y, width: w, height: h, display: "flex", ...style }} />;
}

export interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  color: string;
}

/**
 * Pixel stars scattered over a region, snapped to `grid`, skipping `avoid` rects.
 */
export function makeStars(opts: {
  seed: number;
  count: number;
  area: Rect;
  grid?: number;
  avoid?: Rect[];
  colors?: string[];
}): Star[] {
  const { seed, count, area, grid = 4, avoid = [], colors = ["#f1eee8"] } = opts;
  const r = seeded(seed);
  const stars: Star[] = [];
  let guard = 0;
  while (stars.length < count && guard++ < count * 20) {
    const x = area.x + Math.floor((r() * area.w) / grid) * grid;
    const y = area.y + Math.floor((r() * area.h) / grid) * grid;
    const roll = r();
    const size = roll > 0.92 ? grid * 2 : grid;
    const inside = avoid.some((a) => x + size > a.x && x < a.x + a.w && y + size > a.y && y < a.y + a.h);
    if (inside) continue;
    stars.push({
      x,
      y,
      size,
      opacity: 0.25 + r() * 0.7,
      color: colors[Math.floor(r() * colors.length)] ?? "#f1eee8",
    });
  }
  return stars;
}

export function Stars({ stars }: { stars: Star[] }): ReactElement {
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", display: "flex" }}>
      {stars.map((s, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: s.x,
            top: s.y,
            width: s.size,
            height: s.size,
            background: s.color,
            opacity: s.opacity,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Renders a string pixel map (one char per pixel, "." = transparent) at an
 * integer scale. Horizontal runs of one colour merge into one box.
 */
export function PixelArt({
  rows,
  palette,
  scale,
  x = 0,
  y = 0,
}: {
  rows: readonly string[];
  palette: Readonly<Record<string, string>>;
  scale: number;
  x?: number;
  y?: number;
}): ReactElement {
  const boxes: ReactElement[] = [];
  rows.forEach((row, ry) => {
    let i = 0;
    while (i < row.length) {
      const ch = row[i]!;
      let j = i;
      while (j + 1 < row.length && row[j + 1] === ch) j++;
      const color = palette[ch];
      if (ch !== "." && color) {
        boxes.push(
          <div
            key={`${ry}-${i}`}
            style={{
              position: "absolute",
              left: x + i * scale,
              top: y + ry * scale,
              width: (j - i + 1) * scale,
              height: scale,
              background: color,
            }}
          />,
        );
      }
      i = j + 1;
    }
  });
  return <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", display: "flex" }}>{boxes}</div>;
}
