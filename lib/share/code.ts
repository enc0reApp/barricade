/**
 * Share codes: a spoiler-free, URL-safe summary of a finished set.
 *
 *   /s/12-mstnbhx   → set #12, outcomes main, side, tent, tent... (one letter per round)
 *
 * Distance is derived from the outcomes (never trusted from the URL).
 * Isomorphic — used by the client (share button) and server (share page / OG image).
 */

import {
  type Outcome,
  ROUNDS_PER_SET,
  distanceFor,
  outcomeCode,
  outcomeEmoji,
  outcomeFromCode,
} from "../game/tiers";

export interface ShareSummary {
  number: number;
  outcomes: Outcome[];
  distance: number;
}

export function encodeShareCode(number: number, outcomes: readonly Outcome[]): string {
  return `${number}-${outcomes.map(outcomeCode).join("")}`;
}

export function decodeShareCode(code: string): ShareSummary | null {
  const m = /^(\d{1,5})-([a-z]{1,12})$/.exec(code.trim().toLowerCase());
  if (!m) return null;
  const number = Number(m[1]);
  if (!Number.isInteger(number) || number < 1) return null;
  const outcomes: Outcome[] = [];
  for (const c of m[2]!) {
    const o = outcomeFromCode(c);
    if (!o) return null;
    outcomes.push(o);
  }
  // Preserve tickets shared before the five-question format.
  if (outcomes.length !== ROUNDS_PER_SET && outcomes.length !== 7) return null;
  return { number, outcomes, distance: distanceFor(outcomes, outcomes.length) };
}

export function distanceLine(distance: number): string {
  return distance === 0 ? "ON THE BARRICADE" : `${distance}m from the stage`;
}

/**
 * The text people paste into group chats.
 *
 *   BARRICADE #12 🎟️
 *   14m from the stage
 *   🟨🟪⬛🟩🟪🟪🟦
 *   fstvl.xyz/s/12-hbxnbbs
 */
export function shareText(number: number, outcomes: readonly Outcome[], siteUrl: string): string {
  const distance = distanceFor(outcomes, outcomes.length);
  const host = siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return [
    `BARRICADE #${number} 🎟️`,
    distanceLine(distance),
    outcomes.map(outcomeEmoji).join(""),
    `${host}/s/${encodeShareCode(number, outcomes)}`,
  ].join("\n");
}
