/**
 * Tier-card flavour lines (docs/DESIGN.md). "Random" per tier, but seeded by
 * the set date + round so a reload shows the same line.
 */

import type { Outcome } from "../game/tiers";

export const FLAVOUR: Record<Outcome, readonly string[]> = {
  main: ["The answer everyone yells.", "Half the field said that.", "Solid. Predictable. Loud."],
  tote: ["The 'obscure' pick that isn't.", "Everyone's deep cut.", "Nice tote bag."],
  side: ["Real ones know.", "A respectable push."],
  tent: ["Now we're moving.", "You know your stuff."],
  basement: ["Sweaty room. Great system.", "Heads only."],
  htbt: ["You had to be there. You were.", "Nobody else said that."],
  miss: ["the crowd didn't budge."],
};

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function flavourFor(outcome: Outcome, seed: string): string {
  const lines = FLAVOUR[outcome];
  return lines[hashString(seed) % lines.length] ?? lines[0]!;
}
