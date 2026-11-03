/**
 * Results-screen reveal: "you said X — you could have said…".
 * Pure + deterministic. Only ever called after a set is finished.
 */

import type { AcceptedAnswer, RevealPick, RevealRound } from "../api/contract";
import type { PackAnswer, PackPrompt } from "../content/types";
import type { TierId } from "./tiers";

/** How many picks per tier, in display order (main → htbt). */
export const PICKS_PER_TIER: ReadonlyArray<readonly [TierId, number]> = [
  ["main", 3],
  ["tote", 2],
  ["side", 2],
  ["tent", 2],
  ["basement", 2],
  ["htbt", 3],
];

/** In the deep tiers an answer with a fun fact beats a bare one. */
const NOTE_FIRST: ReadonlySet<TierId> = new Set(["tent", "basement", "htbt"]);

export interface RevealInput {
  answer: AcceptedAnswer;
  /** Real % of today's crowd who gave it, when known. */
  crowdPct: number | null;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function toPick(a: PackAnswer): RevealPick {
  const pick: RevealPick = { name: a.name, type: a.type, tier: a.tier, share: a.share };
  if (a.note) pick.note = a.note;
  return pick;
}

/** The curated spread for one prompt, excluding the player's own answer. */
export function revealPicks(prompt: PackPrompt, excludeId: string | null): RevealPick[] {
  const byTier = new Map<TierId, PackAnswer[]>();
  for (const a of prompt.answers) {
    if (a.id === excludeId) continue;
    const list = byTier.get(a.tier);
    if (list) list.push(a);
    else byTier.set(a.tier, [a]);
  }
  const out: RevealPick[] = [];
  for (const [tier, count] of PICKS_PER_TIER) {
    const list = byTier.get(tier);
    if (!list) continue;
    const noteFirst = NOTE_FIRST.has(tier);
    const sorted = [...list].sort((a, b) => {
      if (noteFirst) {
        const na = a.note ? 0 : 1;
        const nb = b.note ? 0 : 1;
        if (na !== nb) return na - nb;
      }
      if (b.share !== a.share) return b.share - a.share;
      return compareIds(a.id, b.id);
    });
    for (const a of sorted.slice(0, count)) out.push(toPick(a));
  }
  return out;
}

/** One RevealRound per prompt. `yours[i]` is the player's accepted answer for round i (or null). */
export function buildReveal(prompts: readonly PackPrompt[], yours: readonly (RevealInput | null)[]): RevealRound[] {
  return prompts.map((prompt, index) => {
    const mine = yours[index] ?? null;
    const round: RevealRound = {
      index,
      text: prompt.text,
      yours: mine ? { ...mine.answer, crowdPct: mine.crowdPct } : null,
      picks: revealPicks(prompt, mine ? mine.answer.id : null),
      total: prompt.answers.length,
    };
    if (prompt.hint) round.hint = prompt.hint;
    return round;
  });
}
