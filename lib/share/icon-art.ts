/**
 * Pixel maps for the app icons: a lit stage behind the barricade rail.
 * One char per pixel; "." is the background.
 */

import { mixHex, NIGHT } from "./colors";

export const ICON_PALETTE: Readonly<Record<string, string>> = {
  t: "#3b4a8a", // truss
  a: NIGHT.amber, // roof lamps
  m: NIGHT.magenta,
  u: NIGHT.uv,
  c: NIGHT.cyan,
  k: "#070915", // DJ silhouette
  h: "#1c2350", // crowd
  w: NIGHT.ink, // barricade rail
  C: mixHex(NIGHT.sky0, NIGHT.cyan, 0.4), // beams
  U: mixHex(NIGHT.sky0, NIGHT.uv, 0.55),
  M: mixHex(NIGHT.sky0, NIGHT.magenta, 0.4),
};

/** 16×16 — rendered at 2× for the 32px favicon. The ▲ is the game's "push" glyph. */
export const ICON_16: readonly string[] = [
  "................",
  ".tttttttttttttt.",
  ".t..a..aa..a..t.",
  ".tmmmmuuuucccct.",
  ".tmmmmuwwucccct.",
  ".tmmmmwwwwcccct.",
  ".tmmmwwwwwwccct.",
  ".tmmmmuuuucccct.",
  ".tttttttttttttt.",
  "................",
  "..h..h..h..h..h.",
  "wwwwwwwwwwwwwwww",
  "w..w..w..w..w..w",
  "w..w..w..w..w..w",
  "wwwwwwwwwwwwwwww",
  "................",
];

/** 18×18 — rendered at 10× for the 180px apple-touch icon. */
export const ICON_18: readonly string[] = [
  "..C......M......U.",
  "...C.....M.....U..",
  "....C....M....U...",
  ".tttttttttttttttt.",
  ".t.a..a....a..a.t.",
  ".tmmmmmuuuuccccct.",
  ".tmmmmmuwwuccccct.",
  ".tmmmmmwwwwccccct.",
  ".tmmmmwwwwwwcccct.",
  ".tmmmmmuuuuccccct.",
  ".tttttttttttttttt.",
  "..................",
  "..h..h...h..h...h.",
  "hhhhhhhhhhhhhhhhhh",
  "wwwwwwwwwwwwwwwwww",
  "w...w...ww...w...w",
  "w...w...ww...w...w",
  "wwwwwwwwwwwwwwwwww",
];
