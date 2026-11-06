/**
 * The festival field, drawn procedurally into a low-resolution canvas.
 * Everything is seeded, so the same distance always draws the same crowd.
 *
 * World model (metres): the stage front is STAGE_GAP metres beyond the
 * barricade (p = 0). Crowd rows stand at p = k × ROW_SPACING. The viewer is
 * `d` metres from the barricade, so a row at p is z = d − p ahead of them.
 * A slightly raised camera puts nearer heads lower on screen:
 *
 *   yAt(z) = horizon + fieldH × ZC / (z + ZC)     (head line of a row)
 *   sAt(z) = S × ZC / (z + ZC)                     (pixels per metre)
 */

import { START_DISTANCE } from "@/lib/game/tiers";

export const ROW_SPACING = 0.62;
const ZC = 4;
const STAGE_GAP = 6;
const NEAR_SPLIT = 12; // rows nearer than this animate every frame
const FAR_LIMIT = 150;

/* ───────────────────────────── palette ───────────────────────────── */

type RGB = [number, number, number];

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgb = (c: RGB, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

const C = {
  sky0: hex("#151618"),
  sky1: hex("#1c1d22"),
  sky2: hex("#27282f"),
  sky3: hex("#343be8"),
  field0: hex("#16171b"),
  field1: hex("#24252d"),
  glow: hex("#343be8"),
  cyan: hex("#d6ff62"),
  magenta: hex("#ff805c"),
  amber: hex("#ffca6b"),
  uv: hex("#9b8bff"),
  ink: hex("#f5edda"),
  silNear: hex("#101113"),
  silFar: hex("#48425b"),
  steel: hex("#23252d"),
  steelHi: hex("#77718f"),
  rail: hex("#8a93b8"),
  railHi: hex("#d8dcef"),
  phone: hex("#e6f8ff"),
  hivis: hex("#ffd447"),
  loo: hex("#2f62d8"),
};

/* ───────────────────────────── seeded randomness ───────────────────────────── */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ───────────────────────────── view ───────────────────────────── */

export interface View {
  W: number;
  H: number;
  hy: number;
  cx: number;
  S: number;
  fieldH: number;
}

export function makeView(W: number, H: number, horizon: number): View {
  const hy = Math.round(H * horizon);
  return { W, H, hy, cx: Math.floor(W / 2), S: 0.36 * Math.min(W, 0.62 * H) + 15, fieldH: H - hy };
}

export const yAt = (v: View, z: number) => v.hy + (v.fieldH * ZC) / (z + ZC);
export const sAt = (v: View, z: number) => (v.S * ZC) / (z + ZC);

/** Stage width in pixels: tiny from the car park, wider than the screen at the rail. */
export function stageWidth(v: View, d: number): number {
  const base = Math.max(28, v.W * 0.16);
  const c = 87.5;
  return (base * (START_DISTANCE + c)) / (Math.max(0, d) + c);
}

/* ───────────────────────────── background (cached) ───────────────────────────── */

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((n) => (n + 0.5) / 16);

/** Sky + field gradients with ordered dithering, as pixel data. */
export function drawBackground(ctx: CanvasRenderingContext2D, v: View): void {
  const { W, H, hy } = v;
  ctx.fillStyle = rgb(C.sky0);
  ctx.fillRect(0, 0, W, hy);
  ctx.fillStyle = rgb(C.sky2);
  ctx.fillRect(0, Math.max(0, hy - 12), W, 12);
  ctx.fillStyle = rgb(C.field0);
  ctx.fillRect(0, hy, W, H - hy);
}

/* ───────────────────────────── sky detail ───────────────────────────── */

export function drawStars(ctx: CanvasRenderingContext2D, v: View, t: number, still: boolean): void {
  const rnd = mulberry32(7);
  const n = Math.round((v.W * v.hy) / 280);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(rnd() * v.W);
    const y = Math.floor(rnd() * Math.max(1, v.hy - 6));
    const period = 2 + rnd() * 4;
    const phase = rnd() * Math.PI * 2;
    const big = rnd() < 0.08;
    const tw = still ? 0.7 : 0.5 + 0.5 * Math.sin((t / period) * Math.PI * 2 + phase);
    // Quantise brightness to three steps: pixel stars don't fade smoothly.
    const level = tw > 0.75 ? 1 : tw > 0.35 ? 0.6 : 0.28;
    const fade = Math.min(1, (v.hy - y) / (v.hy * 0.35 + 1)); // dimmer near the haze
    ctx.fillStyle = rgb(mix(C.sky1, C.ink, level * (0.35 + 0.65 * fade)));
    ctx.fillRect(x, y, 1, 1);
    if (big && level === 1) {
      ctx.fillStyle = rgb(mix(C.sky1, C.ink, 0.35 * fade));
      ctx.fillRect(x - 1, y, 1, 1);
      ctx.fillRect(x + 1, y, 1, 1);
      ctx.fillRect(x, y - 1, 1, 1);
      ctx.fillRect(x, y + 1, 1, 1);
    }
  }
}

/** The LED wall's wash colour drifts slowly round the stage palette (12s cycle). */
export function washColour(t: number): RGB {
  const cyc = [C.magenta, C.uv, C.cyan, C.uv];
  const u = ((t / 12) % 1 + 1) % 1;
  const f = u * cyc.length;
  const i = Math.floor(f);
  return mix(cyc[i % cyc.length]!, cyc[(i + 1) % cyc.length]!, f - i);
}

/* ───────────────────────────── stage ───────────────────────────── */

export interface StageBox {
  base: number;
  sw: number;
  ledTop: number;
  ledBottom: number;
  lw: number;
  trussY: number;
  roofTop: number;
}

export function stageBox(v: View, d: number): StageBox {
  const sw = stageWidth(v, d);
  const base = Math.round(yAt(v, d + STAGE_GAP)) - 1;
  const dh = Math.max(1, Math.round(sw * 0.05));
  const lw = Math.max(4, Math.round(sw * 0.56));
  const lh = Math.max(2, Math.round(sw * 0.34));
  const ledBottom = base - dh - Math.max(1, Math.round(sw * 0.06));
  const ledTop = ledBottom - lh;
  const trussY = ledTop - Math.max(1, Math.round(sw * 0.07));
  const roofTop = trussY - Math.max(1, Math.round(sw * 0.09));
  return { base, sw, ledTop, ledBottom, lw, trussY, roofTop };
}

export function drawHaze(ctx: CanvasRenderingContext2D, v: View, d: number, t: number): void {
  const b = stageBox(v, d);
  const wash = washColour(t);
  const r = Math.max(36, b.sw * 1.25);
  const cy = (b.ledTop + b.ledBottom) / 2;
  const g = ctx.createRadialGradient(v.cx, cy, 0, v.cx, cy, r);
  g.addColorStop(0, rgb(mix(C.uv, wash, 0.4), 0.42));
  g.addColorStop(0.45, rgb(C.uv, 0.14));
  g.addColorStop(1, rgb(C.uv, 0));
  ctx.fillStyle = g;
  ctx.fillRect(v.cx - r, cy - r, r * 2, r * 2);
}

interface Beam {
  fx: number; // fixture position as a fraction of stage width from centre
  base: number; // radians from vertical
  amp: number;
  period: number;
  phase: number;
  colour: RGB;
}

const BEAMS: Beam[] = [
  { fx: -0.38, base: -0.42, amp: 0.36, period: 11, phase: 0.3, colour: C.uv },
  { fx: -0.14, base: -0.12, amp: 0.4, period: 8.5, phase: 2.1, colour: C.magenta },
  { fx: 0.14, base: 0.12, amp: 0.4, period: 9.6, phase: 4.0, colour: C.cyan },
  { fx: 0.38, base: 0.42, amp: 0.36, period: 13, phase: 1.2, colour: C.amber },
];

export function drawBeams(ctx: CanvasRenderingContext2D, v: View, d: number, t: number, still: boolean): void {
  const b = stageBox(v, d);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const beam of BEAMS) {
    const ang = beam.base + (still ? 0 : beam.amp * Math.sin((t / beam.period) * Math.PI * 2 + beam.phase));
    const x0 = v.cx + beam.fx * b.sw;
    const y0 = b.roofTop + 1;
    const len = (y0 + v.H * 0.15) / Math.max(0.35, Math.cos(ang));
    const spread = len * 0.06 + 1;
    const x1 = x0 + Math.sin(ang) * len;
    const y1 = y0 - Math.cos(ang) * len;
    const nx = Math.cos(ang);
    const ny = Math.sin(ang);
    ctx.fillStyle = rgb(beam.colour, 0.18);
    ctx.beginPath();
    ctx.moveTo(x0 - nx * 0.6, y0 - ny * 0.6);
    ctx.lineTo(x0 + nx * 0.6, y0 + ny * 0.6);
    ctx.lineTo(x1 + nx * spread, y1 + ny * spread);
    ctx.lineTo(x1 - nx * spread, y1 - ny * spread);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

export function drawStage(ctx: CanvasRenderingContext2D, v: View, d: number, t: number, still: boolean): void {
  const b = stageBox(v, d);
  const { sw, base, ledTop, ledBottom, lw, trussY, roofTop } = b;
  const cx = v.cx;
  const wash = washColour(t);
  const half = sw / 2;
  const th = Math.max(1, Math.round(sw * 0.035));
  const tw = Math.max(1, Math.round(sw * 0.04));

  // Roof canopy (dark against the haze), slightly wider than the truss.
  ctx.fillStyle = rgb(C.steel);
  const roofH = trussY - roofTop;
  for (let r = 0; r < roofH; r++) {
    const w = sw * (0.9 + 0.16 * (r / Math.max(1, roofH)));
    rect(ctx, cx - w / 2, roofTop + r, w, 1);
  }
  ctx.fillStyle = rgb(mix(C.steel, wash, 0.35));
  rect(ctx, cx - sw * 0.53, trussY - 1, sw * 1.06, 1);

  // Side towers and the roof truss.
  ctx.fillStyle = rgb(C.steel);
  rect(ctx, cx - half - tw, trussY, tw, base - trussY);
  rect(ctx, cx + half, trussY, tw, base - trussY);
  rect(ctx, cx - half, trussY, sw, th);
  if (tw >= 4) {
    // Lattice on the towers.
    ctx.fillStyle = rgb(C.steelHi);
    for (let y = trussY + th; y < base; y += tw) {
      for (let k = 0; k < tw; k++) {
        ctx.fillRect(Math.round(cx - half - tw + k), Math.round(y + k), 1, 1);
        ctx.fillRect(Math.round(cx + half + tw - 1 - k), Math.round(y + k), 1, 1);
      }
    }
  }
  if (th >= 3) {
    ctx.fillStyle = rgb(C.steelHi);
    for (let x = cx - half; x < cx + half; x += th * 2) {
      for (let k = 0; k < th; k++) ctx.fillRect(Math.round(x + k), Math.round(trussY + k), 1, 1);
    }
  }

  // LED wall.
  const lx = Math.round(cx - lw / 2);
  const lh = ledBottom - ledTop;
  const bgTop = mix(hex("#1b0b36"), wash, 0.22);
  const bgBot = mix(hex("#090718"), wash, 0.1);
  for (let r = 0; r < lh; r++) {
    ctx.fillStyle = rgb(mix(bgTop, bgBot, r / Math.max(1, lh)));
    ctx.fillRect(lx, ledTop + r, lw, 1);
  }
  if (lw < 10) {
    ctx.fillStyle = rgb(mix(wash, C.ink, 0.3), 0.85);
    ctx.fillRect(lx, ledTop, lw, lh);
  } else {
    // A slow visualiser: columns of light, cyan at the top fading to magenta.
    const cols = Math.max(4, Math.floor(lw / Math.max(2, Math.round(lw / 28))));
    const cw = lw / cols;
    for (let i = 0; i < cols; i++) {
      const h0 = still ? 0.55 + 0.35 * Math.sin(i * 0.9) : 0.5 + 0.32 * Math.sin(t * 1.3 + i * 0.62) + 0.14 * Math.sin(t * 0.7 - i * 1.7);
      const ch = Math.max(1, Math.round(lh * Math.min(0.92, Math.max(0.08, h0))));
      for (let r = 0; r < ch; r++) {
        const u = r / Math.max(1, ch);
        ctx.fillStyle = rgb(mix(mix(C.magenta, wash, 0.4), C.cyan, u), 0.85);
        rect(ctx, lx + i * cw, ledBottom - 1 - r, Math.max(1, cw - (cw >= 3 ? 1 : 0)), 1);
      }
    }
    // A horizon line and sun on the wall.
    const sunR = Math.max(1, Math.round(lh * 0.22));
    const sy = ledTop + Math.round(lh * 0.36);
    ctx.fillStyle = rgb(mix(C.amber, C.ink, 0.25), 0.9);
    for (let r = -sunR; r <= sunR; r++) {
      const w = Math.round(Math.sqrt(sunR * sunR - r * r) * 2);
      ctx.fillRect(Math.round(cx - w / 2), sy + r, Math.max(1, w), 1);
    }
    if (lw >= 40) {
      // LED pixel grid.
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      for (let x = lx + 1; x < lx + lw; x += 2) ctx.fillRect(x, ledTop, 1, lh);
      for (let y = ledTop + 1; y < ledBottom; y += 2) ctx.fillRect(lx, y, lw, 1);
    }
  }
  // Wall frame.
  ctx.fillStyle = rgb(C.steel);
  ctx.fillRect(lx - 1, ledTop - 1, lw + 2, 1);
  ctx.fillRect(lx - 1, ledBottom, lw + 2, 1);

  // PA hangs either side of the wall.
  const paW = Math.max(1, Math.round(sw * 0.05));
  const paTop = trussY + th;
  const paH = Math.max(2, Math.round(sw * 0.24));
  for (const side of [-1, 1]) {
    const px = side < 0 ? lx - Math.round(sw * 0.06) - paW : lx + lw + Math.round(sw * 0.06);
    ctx.fillStyle = rgb(hex("#080a16"));
    ctx.fillRect(px, paTop, paW, paH);
    if (paW >= 3) {
      ctx.fillStyle = rgb(C.steelHi, 0.8);
      const box = Math.max(2, Math.round(paH / 8));
      for (let y = paTop + box; y < paTop + paH; y += box) ctx.fillRect(px, y, paW, 1);
    }
    // Side IMAG screens once we're close enough to see them.
    if (sw > 90) {
      const iw = Math.round(sw * 0.13);
      const ih = Math.round(iw * 0.58);
      const ix = side < 0 ? px - Math.round(sw * 0.05) - iw : px + paW + Math.round(sw * 0.05);
      const iy = ledTop + Math.round(lh * 0.2);
      ctx.fillStyle = rgb(mix(hex("#140a2e"), wash, 0.35));
      ctx.fillRect(ix, iy, iw, ih);
      ctx.fillStyle = rgb(mix(wash, C.ink, 0.2), 0.5);
      ctx.fillRect(ix + 1, iy + Math.round(ih * 0.55), iw - 2, Math.max(1, Math.round(ih * 0.3)));
      ctx.fillStyle = rgb(C.steel);
      ctx.fillRect(ix - 1, iy - 1, iw + 2, 1);
      ctx.fillRect(ix - 1, iy + ih, iw + 2, 1);
    }
  }

  // Fixtures along the truss.
  const nFix = Math.max(3, Math.floor(sw / 7));
  const fixCols = [C.cyan, C.magenta, C.amber, C.uv];
  for (let i = 0; i < nFix; i++) {
    const fx = cx - half + ((i + 0.5) * sw) / nFix;
    const on = still ? 1 : 0.65 + 0.35 * Math.sin(t * 0.8 + i * 1.3);
    ctx.fillStyle = rgb(mix(C.steel, fixCols[i % 4]!, on));
    rect(ctx, fx, trussY + th, Math.max(1, sw * 0.012), Math.max(1, sw * 0.012));
  }

  // DJ booth and the act, once the stage is big enough to read.
  if (sw > 46) {
    const bw = Math.round(sw * 0.16);
    const bh = Math.max(2, Math.round(sw * 0.05));
    const by = ledBottom + Math.max(1, Math.round(sw * 0.06)) - bh;
    const s = sw / 46;
    ctx.fillStyle = rgb(hex("#03040a"));
    const bob = still ? 0 : Math.round(Math.sin(t * 4.3) * 0.6 * s * 0.5);
    // Performer: head, body, one hand up.
    rect(ctx, cx - s * 0.7, by - s * 4.4 + bob, s * 1.4, s * 1.5);
    rect(ctx, cx - s * 1.2, by - s * 3 + bob, s * 2.4, s * 3);
    rect(ctx, cx + s * 1.0, by - s * 6 + bob, s * 0.5, s * 3);
    ctx.fillStyle = rgb(hex("#0a0c18"));
    rect(ctx, cx - bw / 2, by, bw, bh);
    ctx.fillStyle = rgb(C.cyan, 0.8);
    rect(ctx, cx - bw / 2 + s, by + Math.max(1, bh * 0.3), Math.max(1, s * 0.6), 1);
    ctx.fillStyle = rgb(C.magenta, 0.8);
    rect(ctx, cx + bw / 2 - s * 1.6, by + Math.max(1, bh * 0.3), Math.max(1, s * 0.6), 1);
  }

  // Deck.
  const dh = Math.max(1, Math.round(sw * 0.05));
  ctx.fillStyle = rgb(hex("#03040a"));
  rect(ctx, cx - half - tw, base - dh, sw + tw * 2, dh + 1);
  ctx.fillStyle = rgb(mix(C.steel, wash, 0.5));
  rect(ctx, cx - half - tw, base - dh, sw + tw * 2, 1);
}

export function drawFog(ctx: CanvasRenderingContext2D, v: View, d: number, t: number, still: boolean): void {
  const b = stageBox(v, d);
  const w = Math.max(40, b.sw * 1.7);
  const wash = washColour(t);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 3; i++) {
    const drift = still ? 0 : Math.sin(t / (7 + i * 2.3) + i * 2) * w * 0.12;
    const cx = v.cx + drift + (i - 1) * w * 0.28;
    const cy = b.base - Math.max(1, b.sw * 0.04) + i;
    const rx = w * (0.32 + i * 0.06);
    const ry = Math.max(3, b.sw * 0.08);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
    g.addColorStop(0, rgb(mix(C.uv, wash, 0.3), 0.16));
    g.addColorStop(1, rgb(C.uv, 0));
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    ctx.translate(-cx, -cy);
    ctx.fillRect(cx - rx, cy - rx, rx * 2, rx * 2);
    ctx.restore();
  }
  ctx.restore();
}

/* ───────────────────────────── crowd ───────────────────────────── */

interface Row {
  xs: Float32Array;
  lift: Float32Array; // head height variation, metres
  hand: Uint8Array; // 0..255 — a hand goes up when below the hype threshold
  bits: Uint8Array; // 1 phone, 2 jumper, 4 tall hair, 8 left hand, 16 cap
  phase: Float32Array;
}

const ROWS = new Map<number, Row>();
const HALF_WIDTH = 46;

function pitHole(p: number, x: number): boolean {
  const dp = p - 150;
  const dx = x + 4.5;
  return (dp * dp) / 18 + (dx * dx) / 22 < 1;
}

function rowAt(k: number): Row {
  const cached = ROWS.get(k);
  if (cached) return cached;
  const rnd = mulberry32((k * 2654435761) ^ 0x9e3779b9);
  const p = k * ROW_SPACING;
  const xs: number[] = [];
  const lift: number[] = [];
  const hand: number[] = [];
  const bits: number[] = [];
  const phase: number[] = [];
  // People thin out a little on the blanket lawn (450m) and near the rail.
  const gap = p > 430 && p < 470 ? 0.9 : 0.44;
  let x = -HALF_WIDTH + rnd() * 0.6;
  while (x < HALF_WIDTH) {
    if (!pitHole(p, x)) {
      xs.push(x);
      lift.push((rnd() - 0.5) * 0.24 - (p > 430 && p < 470 && rnd() < 0.5 ? 0.7 : 0));
      hand.push(Math.floor(rnd() * 256));
      let b = 0;
      if (rnd() < 0.3) b |= 1;
      if (rnd() < 0.45) b |= 2;
      if (rnd() < 0.18) b |= 4;
      if (rnd() < 0.5) b |= 8;
      if (rnd() < 0.08) b |= 16;
      bits.push(b);
      phase.push(rnd() * Math.PI * 2);
    }
    x += gap + rnd() * 0.3;
  }
  const row: Row = {
    xs: Float32Array.from(xs),
    lift: Float32Array.from(lift),
    hand: Uint8Array.from(hand),
    bits: Uint8Array.from(bits),
    phase: Float32Array.from(phase),
  };
  if (ROWS.size > 2400) ROWS.clear();
  ROWS.set(k, row);
  return row;
}

interface CrowdOpts {
  t: number;
  hype: number;
  still: boolean;
  rim: RGB;
}

function drawRow(ctx: CanvasRenderingContext2D, v: View, k: number, z: number, o: CrowdOpts): void {
  const s = sAt(v, z);
  const y0 = yAt(v, z);
  if (y0 > v.H + 2) return;
  const row = rowAt(k);
  // Atmospheric depth: near rows are black, far rows pick up the purple haze.
  const shade = Math.pow(1 - ZC / (z + ZC), 1.25);
  const sil = mix(C.silNear, C.silFar, shade);
  const rimAmt = 0.8 - 0.5 * shade;
  const silCss = rgb(sil);
  const rimCss = rgb(mix(sil, o.rim, rimAmt));
  const rimSoft = rgb(mix(sil, o.rim, rimAmt * 0.42));
  // Heads and shoulder tops catch the light from above; bodies stay dark, so
  // every row of heads reads against the dark backs in front of it.
  const lit = 1 - shade * 0.6;
  const headTones = [0.15, 0.21, 0.27].map((k) => rgb(mix(sil, o.rim, k * lit)));
  const shoulderCss = rgb(mix(sil, o.rim, 0.16 * lit));
  const phoneCss = rgb(C.phone);
  const handThreshold = 255 * (0.1 + 0.42 * o.hype);
  const beat = o.t * Math.PI * (124 / 60);
  const visibleHalf = v.W / 2 / s + 1;
  const xs = row.xs;

  if (s < 1.6) {
    // Far LOD: a head pixel each, the odd phone light above.
    ctx.fillStyle = silCss;
    const yy = Math.round(y0) - 1;
    for (let i = 0; i < xs.length; i++) {
      const wx = xs[i]!;
      if (wx < -visibleHalf || wx > visibleHalf) continue;
      ctx.fillRect(Math.round(v.cx + wx * s), yy - (row.lift[i]! > 0.08 ? 1 : 0), 1, 2);
    }
    ctx.fillStyle = rgb(mix(C.phone, sil, 0.15 + shade * 0.35));
    for (let i = 0; i < xs.length; i++) {
      if (i % 9 !== 0 || (row.bits[i]! & 1) === 0 || row.hand[i]! > handThreshold * 0.28) continue;
      const wx = xs[i]!;
      if (wx < -visibleHalf || wx > visibleHalf) continue;
      ctx.fillRect(Math.round(v.cx + wx * s), yy - 2, 1, 1);
    }
    return;
  }

  const headW = Math.max(1, Math.round(0.17 * s));
  const headH = Math.max(1, Math.round(0.21 * s));
  const neckH = s >= 10 ? Math.max(1, Math.round(0.035 * s)) : 0;
  const neckW = Math.max(1, Math.round(0.08 * s));
  const shW = Math.max(headW + 1, Math.round(0.5 * s));
  const shTop = Math.max(headW + 1, Math.round(0.3 * s));
  const slopeH = s >= 9 ? Math.max(1, Math.round(0.07 * s)) : 0;
  const bodyH = Math.max(2, Math.ceil(1.3 * s));
  const armW = Math.max(1, Math.round(0.07 * s));
  const handW = Math.max(1, Math.round(0.095 * s));
  const handH = Math.max(1, Math.round(0.1 * s));
  const shaveHead = headW >= 4;
  const animate = !o.still && z < NEAR_SPLIT;

  for (let i = 0; i < xs.length; i++) {
    const wx = xs[i]!;
    if (wx < -visibleHalf || wx > visibleHalf) continue;
    const bits = row.bits[i]!;
    const handUp = row.hand[i]! < handThreshold;
    let bob = 0;
    if (animate && bits & 2) bob = -Math.round(Math.abs(Math.sin(beat + row.phase[i]!)) * 0.06 * s * (0.5 + o.hype));
    const sx = Math.round(v.cx + wx * s);
    const top = Math.round(y0 - row.lift[i]! * s) + bob;
    const hx = sx - (headW >> 1);
    const headTop = top - neckH - headH;

    // Body first (dark), then the lit shoulder tops sloping out to full width.
    ctx.fillStyle = silCss;
    ctx.fillRect(sx - (shW >> 1), top + slopeH, shW, bodyH);
    const band = Math.max(1, Math.round(0.16 * s));
    ctx.fillStyle = shoulderCss;
    for (let r = 0; r < slopeH; r++) {
      const w = Math.round(shTop + ((shW - shTop) * (r + 1)) / (slopeH + 1));
      ctx.fillRect(sx - (w >> 1), top + r, w, 1);
    }
    ctx.fillRect(sx - (shW >> 1), top + slopeH, shW, band);
    ctx.fillStyle = silCss;
    if (neckH) ctx.fillRect(sx - (neckW >> 1), top - neckH, neckW, neckH);
    ctx.fillStyle = headTones[Math.floor(row.phase[i]!) % 3]!;
    if (headW >= 8) {
      ctx.fillRect(hx + 2, headTop, headW - 4, 1);
      ctx.fillRect(hx + 1, headTop + 1, headW - 2, 1);
      ctx.fillRect(hx, headTop + 2, headW, headH - 3);
      ctx.fillRect(hx + 1, headTop + headH - 1, headW - 2, 1);
    } else if (shaveHead) {
      ctx.fillRect(hx + 1, headTop, headW - 2, headH);
      ctx.fillRect(hx, headTop + 1, headW, headH - 2);
    } else {
      ctx.fillRect(hx, headTop, headW, headH + (neckH ? 0 : 1));
    }
    if (bits & 4 && headW >= 3) ctx.fillRect(sx + (row.phase[i]! > 3 ? 0 : -1) - 1, headTop - Math.max(1, Math.round(0.05 * s)), Math.max(2, headW >> 1), Math.max(1, Math.round(0.06 * s)));
    if (bits & 16 && headW >= 3) ctx.fillRect(hx - 1, headTop + 1, headW + 2, 1);

    let handTop = 0;
    let ax = 0;
    if (handUp) {
      const left = (bits & 8) !== 0;
      ax = left ? sx - (shW >> 1) + Math.round(shW * 0.08) : sx + (shW >> 1) - Math.round(shW * 0.08) - armW;
      const reach = Math.round((0.6 + (row.phase[i]! % 0.25)) * s);
      handTop = top - reach;
      ctx.fillRect(ax, handTop, armW, reach + slopeH + 1);
      ctx.fillRect(ax - ((handW - armW) >> 1), handTop - handH, handW, handH);
    }

    if (s >= 3) {
      // Rim light: tops of heads and shoulders, the edge facing the stage centre.
      ctx.fillStyle = rimCss;
      const inset = headW >= 8 ? 2 : shaveHead ? 1 : 0;
      ctx.fillRect(hx + inset, headTop, Math.max(1, headW - inset * 2), 1);
      if (handUp) ctx.fillRect(ax - ((handW - armW) >> 1), handTop - handH, handW, 1);
      ctx.fillStyle = rimSoft;
      if (slopeH) ctx.fillRect(sx - (shTop >> 1), top, shTop, 1);
      else ctx.fillRect(sx - (shW >> 1), top, shW, 1);
      if (headH >= 3) {
        const edge = wx < 0 ? hx + headW - 1 : hx;
        ctx.fillRect(edge, headTop + 1, 1, headH - 2);
      }
    }

    if (bits & 1 && handUp) {
      const pw = Math.max(1, Math.round(0.06 * s));
      const ph = Math.max(1, Math.round(0.1 * s));
      const px = ax + (armW >> 1) - (pw >> 1);
      const py = handTop - handH - ph + 1;
      if (s >= 8) {
        ctx.fillStyle = "rgba(160, 235, 255, 0.16)";
        ctx.fillRect(px - 1, py - 1, pw + 2, ph + 2);
      }
      ctx.fillStyle = phoneCss;
      ctx.fillRect(px, py, pw, ph);
    }
  }
}

/* ───────────────────────────── landmarks ───────────────────────────── */

type LandmarkDraw = (ctx: CanvasRenderingContext2D, v: View, z: number, o: CrowdOpts) => void;

interface Landmark {
  p: number;
  draw: LandmarkDraw;
  /** Drawn every frame on top of the cached far layer (only the part above the crowd). */
  animated?: boolean;
}

/** Converts a world (x metres, height metres above the head line) to screen at depth z. */
function at(v: View, z: number, x: number, h: number): [number, number, number] {
  const s = sAt(v, z);
  return [v.cx + x * s, yAt(v, z) - h * s, s];
}

function box(ctx: CanvasRenderingContext2D, v: View, z: number, x: number, w: number, h0: number, h1: number, colour: string) {
  const [sx, sy, s] = at(v, z, x, h1);
  ctx.fillStyle = colour;
  rect(ctx, sx, sy, w * s, (h1 - h0) * s);
}

const LANDMARKS: Landmark[] = [
  {
    // Wristband scanners: two lit arches.
    p: 650,
    draw(ctx, v, z) {
      for (const x of [-7, 5]) {
        box(ctx, v, z, x, 0.3, -1.6, 1.5, rgb(C.steel));
        box(ctx, v, z, x + 2.2, 0.3, -1.6, 1.5, rgb(C.steel));
        box(ctx, v, z, x, 2.5, 1.2, 1.6, rgb(C.steel));
        box(ctx, v, z, x + 0.4, 1.7, 1.3, 1.45, rgb(C.cyan, 0.9));
      }
    },
  },
  {
    // The merch tent: striped canopy, a lit counter, a queue that never moves.
    p: 600,
    draw(ctx, v, z) {
      const x = -17.5;
      box(ctx, v, z, x, 6, -1.6, 2.0, rgb(hex("#0b0e1e")));
      box(ctx, v, z, x + 0.4, 5.2, 0.3, 1.8, rgb(mix(C.amber, C.ink, 0.35), 0.9));
      box(ctx, v, z, x + 0.9, 0.9, 1.2, 1.6, rgb(C.magenta));
      box(ctx, v, z, x + 2.3, 0.9, 1.2, 1.6, rgb(C.cyan));
      box(ctx, v, z, x + 3.7, 0.9, 1.2, 1.6, rgb(C.ink));
      box(ctx, v, z, x + 0.2, 5.6, 0.05, 0.45, rgb(hex("#14182e")));
      for (let i = 0; i < 6; i++) {
        const colour = i % 2 ? rgb(C.magenta) : rgb(mix(C.ink, C.uv, 0.15));
        box(ctx, v, z, x - 0.3 + i * 1.1, 1.1, 2.0, 2.6, colour);
        box(ctx, v, z, x + 0.25 + i * 0.92, 0.92, 2.6, 3.0, colour);
      }
    },
  },
  {
    // Portaloo row.
    p: 550,
    draw(ctx, v, z) {
      for (let i = 0; i < 7; i++) {
        const x = 9 + i * 1.35;
        box(ctx, v, z, x, 1.2, -1.6, 0.9, rgb(mix(C.loo, C.sky0, 0.35)));
        box(ctx, v, z, x, 1.2, 0.8, 1.0, rgb(mix(C.loo, C.ink, 0.2)));
        box(ctx, v, z, x + 0.5, 0.2, 0.55, 0.7, i % 3 === 1 ? rgb(C.magenta) : rgb(hex("#3ddc84")));
      }
    },
  },
  {
    // The $19 noodle stall: amber canopy, hot window, string lights.
    p: 500,
    draw(ctx, v, z) {
      const x = -14.5;
      box(ctx, v, z, x, 4.6, -1.6, 2.0, rgb(hex("#0d1020")));
      box(ctx, v, z, x + 0.4, 3.8, 0.4, 1.6, rgb(mix(C.amber, C.ink, 0.2)));
      box(ctx, v, z, x + 0.6, 0.5, 0.9, 1.3, rgb(hex("#3d1d06")));
      box(ctx, v, z, x + 1.5, 0.5, 0.9, 1.3, rgb(hex("#3d1d06")));
      for (let i = 0; i < 5; i++) {
        box(ctx, v, z, x - 0.2 + i * 1.0, 1.0, 2.0, 2.5, i % 2 ? rgb(C.amber) : rgb(mix(C.amber, C.sky0, 0.45)));
      }
      box(ctx, v, z, x + 0.6, 3.4, 2.55, 3.15, rgb(hex("#14182e")));
      box(ctx, v, z, x + 0.9, 2.8, 2.7, 3.0, rgb(C.amber));
      const [sx, sy, s] = at(v, z, x - 0.6, 3.35);
      ctx.fillStyle = rgb(mix(C.amber, C.ink, 0.5));
      for (let i = 0; i < 8; i++) rect(ctx, sx + i * 0.8 * s, sy + (i % 2) * 0.12 * s, Math.max(1, 0.12 * s), Math.max(1, 0.12 * s));
    },
  },
  {
    // Delay towers left and right: scaffold legs, braces, a speaker hang on top.
    p: 400,
    draw(ctx, v, z) {
      const steel = rgb(C.steel);
      for (const x of [-10, 9.4]) {
        box(ctx, v, z, x, 0.14, -1.6, 8.8, steel);
        box(ctx, v, z, x + 0.9, 0.14, -1.6, 8.8, steel);
        const [lx, , s] = at(v, z, x, 0);
        if (s >= 2) {
          ctx.fillStyle = steel;
          for (let h = 0; h < 8.6; h += 1.1) {
            const [, yy] = at(v, z, x, h);
            const steps = Math.max(1, Math.round(0.9 * s));
            for (let k = 0; k < steps; k++) ctx.fillRect(Math.round(lx + k), Math.round(yy - (k * 1.1 * s) / steps), 1, 1);
          }
        }
        box(ctx, v, z, x - 0.55, 2.0, 8.8, 11.0, rgb(hex("#080a16")));
        box(ctx, v, z, x - 0.55, 2.0, 10.85, 11.0, rgb(C.steelHi));
        const [sx, sy, s2] = at(v, z, x + 0.35, 11.4);
        ctx.fillStyle = rgb(C.amber);
        rect(ctx, sx, sy, Math.max(1, 0.2 * s2), Math.max(1, 0.2 * s2));
      }
    },
  },
  {
    // The flag guy.
    p: 350,
    animated: true,
    draw(ctx, v, z, o) {
      const x = 2.8;
      const [px, py, s] = at(v, z, x, 4.2);
      const [, baseY] = at(v, z, x, 0.15);
      ctx.fillStyle = rgb(hex("#2a3150"));
      rect(ctx, px, py, Math.max(1, 0.06 * s), baseY - py);
      const fw = Math.max(3, 1.4 * s);
      const fh = Math.max(2, 0.85 * s);
      const rows = Math.max(2, Math.round(fh));
      for (let r = 0; r < rows; r++) {
        const wave = o.still ? 0 : Math.sin(o.t * 2.2 + r * 0.25) * 0.12 * s;
        const u = r / rows;
        ctx.fillStyle = rgb(u < 0.34 ? C.magenta : u < 0.67 ? C.ink : C.cyan);
        rect(ctx, px + Math.max(1, 0.06 * s), py + r * (fh / rows) + wave * 0.3, fw + wave, Math.max(1, fh / rows));
      }
    },
  },
  {
    // Front-of-house: the mix tent in the middle of the field.
    p: 300,
    draw(ctx, v, z) {
      const x = -3.4;
      box(ctx, v, z, x, 6.4, -1.6, 2.1, rgb(hex("#0a0d1c")));
      box(ctx, v, z, x - 0.3, 7.0, 2.1, 2.7, rgb(hex("#1d2246")));
      box(ctx, v, z, x - 0.3, 7.0, 2.6, 2.7, rgb(C.steelHi));
      const [sx, sy, s] = at(v, z, x + 0.8, 0.55);
      const cols = [C.cyan, C.amber, C.magenta, C.cyan, C.uv, C.amber];
      for (let i = 0; i < cols.length; i++) {
        ctx.fillStyle = rgb(cols[i]!);
        rect(ctx, sx + i * 0.8 * s, sy, Math.max(1, 0.25 * s), Math.max(1, 0.12 * s));
      }
    },
  },
  {
    // Someone on someone's shoulders.
    p: 200,
    draw(ctx, v, z, o) {
      const [sx, sy, s] = at(v, z, 2.4, 0.9);
      const sil = rgb(mix(C.silNear, C.silFar, Math.min(1, z / 70)));
      ctx.fillStyle = sil;
      rect(ctx, sx - 0.24 * s, sy, 0.48 * s, 0.9 * s);
      rect(ctx, sx - 0.11 * s, sy - 0.26 * s, 0.22 * s, 0.26 * s);
      rect(ctx, sx - 0.5 * s, sy - 0.6 * s, Math.max(1, 0.08 * s), 0.7 * s);
      rect(ctx, sx + 0.42 * s, sy - 0.6 * s, Math.max(1, 0.08 * s), 0.7 * s);
      ctx.fillStyle = rgb(mix(C.silNear, o.rim, 0.5));
      rect(ctx, sx - 0.11 * s, sy - 0.26 * s, 0.22 * s, 1);
    },
  },
  {
    // A crowd-surfer, carried on hands.
    p: 100,
    draw(ctx, v, z, o) {
      const [sx, sy, s] = at(v, z, 0.6, 0.55);
      const sil = rgb(mix(C.silNear, C.silFar, Math.min(1, z / 70)));
      ctx.fillStyle = sil;
      rect(ctx, sx - 0.85 * s, sy, 1.5 * s, 0.26 * s);
      rect(ctx, sx + 0.65 * s, sy - 0.08 * s, 0.24 * s, 0.24 * s);
      rect(ctx, sx - 1.15 * s, sy - 0.18 * s, 0.35 * s, Math.max(1, 0.08 * s));
      for (const hx of [-0.6, -0.1, 0.4]) rect(ctx, sx + hx * s, sy + 0.26 * s, Math.max(1, 0.07 * s), 0.35 * s);
      ctx.fillStyle = rgb(mix(C.silNear, o.rim, 0.6));
      rect(ctx, sx - 0.85 * s, sy, 1.5 * s, 1);
    },
  },
  {
    // Camped out since 6am: a totem with a smiley sign.
    p: 50,
    draw(ctx, v, z) {
      const x = -3.3;
      const [px, py, s] = at(v, z, x, 3.6);
      const [, by] = at(v, z, x, 0);
      ctx.fillStyle = rgb(hex("#2a3150"));
      rect(ctx, px, py, Math.max(1, 0.06 * s), by - py);
      const w = Math.max(3, 0.9 * s);
      ctx.fillStyle = rgb(C.amber);
      rect(ctx, px - w / 2, py - w, w, w);
      if (w >= 6) {
        ctx.fillStyle = rgb(C.sky0);
        const u = w / 6;
        rect(ctx, px - w / 2 + 1.5 * u, py - w + 1.6 * u, u, u);
        rect(ctx, px - w / 2 + 3.5 * u, py - w + 1.6 * u, u, u);
        rect(ctx, px - w / 2 + 1.5 * u, py - w + 3.6 * u, 3 * u, u);
      }
    },
  },
];

function drawLandmarkTop(ctx: CanvasRenderingContext2D, v: View, lm: Landmark, z: number, o: CrowdOpts) {
  // Only the part above this landmark's own head line (the crowd in front covers the rest).
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, v.W, Math.round(yAt(v, z)) - 1);
  ctx.clip();
  lm.draw(ctx, v, z, o);
  ctx.restore();
}

/* ───────────────────────────── barricade + pit ───────────────────────────── */

function drawPit(ctx: CanvasRenderingContext2D, v: View, d: number, o: CrowdOpts) {
  // Security in hi-vis on the far side of the rail.
  const z = d + 2;
  if (z > 70) return;
  const s = sAt(v, z);
  const y = yAt(v, z);
  for (const x of [-4.2, 3.6]) {
    const sx = v.cx + x * s;
    ctx.fillStyle = rgb(C.silNear);
    rect(ctx, sx - 0.11 * s, y - 0.26 * s, 0.22 * s, 0.26 * s);
    ctx.fillStyle = rgb(mix(C.hivis, C.sky0, 0.25));
    rect(ctx, sx - 0.25 * s, y, 0.5 * s, 0.7 * s);
    ctx.fillStyle = rgb(C.ink, 0.85);
    rect(ctx, sx - 0.25 * s, y + 0.3 * s, 0.5 * s, Math.max(1, 0.06 * s));
    ctx.fillStyle = rgb(mix(C.silNear, o.rim, 0.5));
    rect(ctx, sx - 0.11 * s, y - 0.26 * s, 0.22 * s, 1);
  }
}

function drawBarricade(ctx: CanvasRenderingContext2D, v: View, d: number) {
  const z = d + 0.7;
  if (z > 130) return;
  const s = sAt(v, z);
  const top = Math.round(yAt(v, z) - 0.12 * s);
  const h = Math.max(2, Math.round(1.1 * s));
  const barH = Math.max(1, Math.round(0.07 * s));
  // Panels between posts.
  ctx.fillStyle = rgb(mix(C.rail, C.sky0, 0.55));
  ctx.fillRect(0, top + barH, v.W, h);
  // Vertical slats.
  const step = Math.max(2, Math.round(0.16 * s));
  ctx.fillStyle = rgb(mix(C.rail, C.sky0, 0.25));
  for (let x = ((v.cx % step) + step) % step; x < v.W; x += step) ctx.fillRect(x, top + barH, Math.max(1, Math.round(step * 0.3)), h);
  // Posts.
  const post = Math.max(3, Math.round(1.2 * s));
  ctx.fillStyle = rgb(mix(C.rail, C.sky0, 0.1));
  for (let x = ((v.cx % post) + post) % post; x < v.W; x += post) ctx.fillRect(x, top, Math.max(1, Math.round(0.08 * s)), h + barH);
  // Top rail with a highlight.
  ctx.fillStyle = rgb(C.rail);
  ctx.fillRect(0, top, v.W, barH + 1);
  ctx.fillStyle = rgb(C.railHi);
  ctx.fillRect(0, top, v.W, 1);
}

/* ───────────────────────────── crowd passes ───────────────────────────── */

/**
 * Draws crowd rows and landmarks with z in [zMin, zMax), far → near.
 * The far pass is cached by the host; the near pass runs every frame.
 */
export function drawCrowd(
  ctx: CanvasRenderingContext2D,
  v: View,
  d: number,
  part: "far" | "near",
  o: CrowdOpts,
): void {
  const zMin = part === "near" ? 0.3 : NEAR_SPLIT;
  const zMax = part === "near" ? NEAR_SPLIT : FAR_LIMIT;
  // Rows ahead: p in (0, d) ⇒ k in [1, floor(d / ROW_SPACING)]
  const kNear = Math.floor((d - zMin) / ROW_SPACING);
  const kFar = Math.max(1, Math.ceil((d - zMax) / ROW_SPACING));
  const ordered = LANDMARKS.filter((l) => d - l.p >= zMin && d - l.p < zMax).sort((a, b) => a.p - b.p);
  let lmIndex = 0;
  const drawLm = (lm: Landmark) => {
    if (!(lm.animated && part === "far")) lm.draw(ctx, v, d - lm.p, o);
  };
  // The pit and the rail are beyond every crowd row, so they go down first.
  const zRail = d + 0.7;
  if (zRail >= zMin && zRail < zMax) {
    drawPit(ctx, v, d, o);
    drawBarricade(ctx, v, d);
  }
  // k ascending = p ascending = farthest from the viewer first (painter's order).
  for (let k = kFar; k <= kNear; k++) {
    const p = k * ROW_SPACING;
    const z = d - p;
    while (lmIndex < ordered.length && ordered[lmIndex]!.p <= p) drawLm(ordered[lmIndex++]!);
    // Thin out rows that would sit sub-pixel apart; modulo keeps the choice stable while moving.
    if (z > 60 ? k % 3 !== 0 : z > 30 ? k % 2 !== 0 : false) continue;
    if (z >= zMin && z < zMax) drawRow(ctx, v, k, z, o);
  }
  while (lmIndex < ordered.length) drawLm(ordered[lmIndex++]!);
}

/** Animated landmark tops for the far zone (drawn over the cached far layer). */
export function drawAnimatedFar(ctx: CanvasRenderingContext2D, v: View, d: number, o: CrowdOpts): void {
  for (const lm of LANDMARKS) {
    if (!lm.animated) continue;
    const z = d - lm.p;
    if (z >= NEAR_SPLIT && z < FAR_LIMIT) drawLandmarkTop(ctx, v, lm, z, o);
  }
}

export function crowdOpts(t: number, hype: number, still: boolean): CrowdOpts {
  return { t, hype, still, rim: mix(washColour(t), C.ink, 0.15) };
}

/** The far crowd is cached; its rim colour changes slowly, so a stable key is fine. */
export function farCrowdOpts(hype: number): CrowdOpts {
  return { t: 0, hype, still: true, rim: mix(C.magenta, C.uv, 0.5) };
}
