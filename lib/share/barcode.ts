/**
 * Deterministic pixel barcode for a share code. Pure and isomorphic.
 *
 *   const { modules, bars } = barcode("12-hbxnbbs");
 *
 * - `modules`: `length` booleans, left → right. `true` = an ink column one
 *   module wide. Handy for a CSS grid or a canvas.
 * - `bars`: the same ink merged into runs, `{ x, w, guard }` in module units.
 *   Draw each as a rect at `x * unit` with width `w * unit`. `guard` bars are
 *   the EAN-style start / centre / end markers — draw them a little longer
 *   than the data bars for the classic look.
 *
 * It isn't a scannable symbology; it's a decoration that is unique-looking per
 * code and identical on the server (OG image) and the client (HTML ticket).
 * The code is trimmed and lowercased first, like decodeShareCode.
 */

import { fnv1a, seeded as rng } from "./rng";

export const BARCODE_MODULES = 64;

export interface BarcodeBar {
  /** Left edge, in modules. */
  x: number;
  /** Width, in modules (guards are 1, data bars 1–3). */
  w: number;
  guard: boolean;
}

export interface Barcode {
  length: number;
  modules: boolean[];
  bars: BarcodeBar[];
}

/** Bar widths 1–3 (thin bars commonest), spaces 1–2. */
function runWidth(r: number, isBar: boolean): number {
  if (isBar) return r < 0.45 ? 1 : r < 0.8 ? 2 : 3;
  return r < 0.6 ? 1 : 2;
}

export function barcode(code: string, length: number = BARCODE_MODULES): Barcode {
  if (!Number.isInteger(length) || length < 24) {
    throw new RangeError(`barcode length must be an integer >= 24 (got ${length})`);
  }
  const key = code.trim().toLowerCase();
  const next = rng(fnv1a(`barricade:${key}`));
  const modules = new Array<boolean>(length).fill(false);
  const guard = new Array<boolean>(length).fill(false);

  const setGuard = (i: number) => {
    modules[i] = true;
    guard[i] = true;
  };
  // Start guard 1 0 1, end guard 1 0 1, centre guard 0 1 0 1 0.
  setGuard(0);
  setGuard(2);
  setGuard(length - 1);
  setGuard(length - 3);
  const mid = Math.floor(length / 2);
  setGuard(mid - 1);
  setGuard(mid + 1);

  // Data fills [4, mid-2) and [mid+3, length-4), each ringed by a quiet module.
  const fill = (from: number, to: number) => {
    let i = from;
    let isBar = true;
    while (i < to) {
      const w = runWidth(next(), isBar);
      for (let k = 0; k < w && i < to; k++, i++) modules[i] = isBar;
      isBar = !isBar;
    }
  };
  fill(4, mid - 2);
  fill(mid + 3, length - 4);

  const bars: BarcodeBar[] = [];
  for (let i = 0; i < length; i++) {
    if (!modules[i]) continue;
    if (guard[i]) {
      bars.push({ x: i, w: 1, guard: true });
      continue;
    }
    let j = i;
    while (j + 1 < length && modules[j + 1] && !guard[j + 1]) j++;
    bars.push({ x: i, w: j - i + 1, guard: false });
    i = j;
  }
  return { length, modules, bars };
}
