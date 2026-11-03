/**
 * Keyboard guards. When a round's clock runs out the input blurs and KEEP
 * PUSHING takes focus at once, so an Enter meant to submit (or the space in a
 * two-word answer) would press it. Only fresh key presses advance.
 */

/** How long after the reveal appears an Enter/Space is treated as left over from typing. */
export const REVEAL_KEY_GUARD_MS = 500;

/** True when an Enter/Space keydown should NOT activate the reveal's button. */
export function isStaleActivation(e: { key: string; repeat: boolean }, msSinceReveal: number): boolean {
  if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return false;
  return e.repeat || msSinceReveal < REVEAL_KEY_GUARD_MS;
}
