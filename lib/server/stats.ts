/**
 * Crowd-stat maths over a DateStats snapshot. Pure.
 */

import type { CrowdRound } from "../api/contract";
import type { PackAnswer, PackPuzzle } from "../content/types";
import { pct } from "../game/rules";
import { START_DISTANCE, TIER_IDS } from "../game/tiers";
import { MISS_FIELD, type DateStats } from "../store/types";

/** Per-round crowd % is only shown once this many players have finished. */
export const MIN_PLAYS_FOR_ROUND_PCT = 20;
export const BUCKET_METRES = 50;
export const BUCKETS = START_DISTANCE / BUCKET_METRES + 1;
export const TOP_PER_ROUND = 8;
export const SINGLE_NAMES = 5;

/** % of finished players whose distance is strictly greater (further back) than yours. */
export function beatPct(stats: Pick<DateStats, "plays" | "hist">, distance: number): number | null {
  if (stats.plays < 1) return null;
  let behind = 0;
  for (const [d, count] of stats.hist) if (d > distance) behind += count;
  return Math.min(100, pct(behind, stats.plays));
}

export function roundCrowdPct(stats: DateStats, round: number, answerId: string): number | null {
  if (stats.plays < MIN_PLAYS_FOR_ROUND_PCT) return null;
  return Math.min(100, pct(stats.rounds[round]?.get(answerId) ?? 0, stats.plays));
}

/** Players per 50m bucket: [0–49, 50–99, …, 450–499, 500]. All misses stand alone. */
export function distribution(hist: Map<number, number>, maxDistance = START_DISTANCE): number[] {
  const buckets = maxDistance / BUCKET_METRES + 1;
  const out = new Array<number>(buckets).fill(0);
  for (const [d, count] of hist) {
    if (!Number.isFinite(d) || count <= 0) continue;
    const b = Math.min(buckets - 1, Math.max(0, Math.floor(Math.min(d, maxDistance) / BUCKET_METRES)));
    out[b] = (out[b] ?? 0) + count;
  }
  return out;
}

const tierDepth = (a: PackAnswer) => TIER_IDS.indexOf(a.tier);
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function crowdRounds(puzzle: PackPuzzle, stats: DateStats): CrowdRound[] {
  return puzzle.prompts.map((prompt, index) => {
    const answers = new Map(prompt.answers.map((a) => [a.id, a] as const));
    const counts = stats.rounds[index] ?? new Map<string, number>();
    const given: { answer: PackAnswer; count: number }[] = [];
    let singles = 0;
    for (const [id, count] of counts) {
      if (id === MISS_FIELD || count <= 0) continue;
      if (count === 1) singles++;
      const answer = answers.get(id);
      if (answer) given.push({ answer, count });
    }
    const top = [...given]
      .sort((a, b) => b.count - a.count || tierDepth(b.answer) - tierDepth(a.answer) || byId(a.answer, b.answer))
      .slice(0, TOP_PER_ROUND)
      .map(({ answer, count }) => ({ name: answer.name, tier: answer.tier, pct: pct(count, stats.plays) }));
    const singleNames = given
      .filter((g) => g.count === 1)
      .map((g) => g.answer)
      .sort((a, b) => tierDepth(b) - tierDepth(a) || a.share - b.share || byId(a, b))
      .slice(0, SINGLE_NAMES)
      .map((a) => a.name);
    return {
      index,
      text: prompt.text,
      top,
      singles,
      singleNames,
      missPct: pct(counts.get(MISS_FIELD) ?? 0, stats.plays),
    };
  });
}
