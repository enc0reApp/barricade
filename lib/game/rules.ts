/**
 * Small shared game rules used by the engine (routes, reveal, tokens).
 * Isomorphic — no node: imports.
 */

import type { AcceptedAnswer } from "../api/contract";
import type { PackAnswer, PackPrompt } from "../content/types";
import { DEFAULT_SECONDS, TIERS } from "./tiers";

/** Client-generated anonymous id (stored in localStorage). */
export const PLAYER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function isPlayerId(x: unknown): x is string {
  return typeof x === "string" && PLAYER_ID_RE.test(x);
}

/** Hard ceiling on rounds in any set (indexes are validated against the real set too). */
export const MAX_ROUNDS = 32;

export function isRoundIndex(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 0 && x < MAX_ROUNDS;
}

/** Seconds on the clock for a prompt (pack value, else the default). */
export function roundSeconds(prompt: Pick<PackPrompt, "seconds">): number {
  const s = prompt.seconds;
  return typeof s === "number" && Number.isFinite(s) && s > 0 ? s : DEFAULT_SECONDS;
}

/** The public view of an accepted pack answer. Points always come from TIERS. */
export function toAccepted(answer: PackAnswer): AcceptedAnswer {
  const out: AcceptedAnswer = {
    id: answer.id,
    name: answer.name,
    type: answer.type,
    tier: answer.tier,
    points: TIERS[answer.tier].points,
    share: answer.share,
  };
  if (answer.note) out.note = answer.note;
  return out;
}

/** Percent with one decimal place. */
export function pct(count: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.round((count / total) * 1000) / 10;
}
