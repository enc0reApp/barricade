/**
 * Rarity tiers. This file is the single source of truth for points, labels,
 * share emoji and the share-code letters. UI colours live in CSS as
 * --tier-<id> custom properties (see app/tokens.css).
 *
 * The scoring metaphor: every set starts at the back of the field,
 * START_DISTANCE metres from the stage. Each accepted answer moves you
 * `points` metres closer. Seven perfect answers (7 × 100) put you on the
 * barricade at 0m.
 */

export const TIER_IDS = ["main", "tote", "side", "tent", "basement", "htbt"] as const;
export type TierId = (typeof TIER_IDS)[number];

/** A round's outcome: a tier, or a miss (nothing accepted before the clock ran out). */
export type Outcome = TierId | "miss";

export interface TierDef {
  id: TierId;
  /** Display label, uppercase, short enough for a pixel badge. */
  label: string;
  /** One-line description for How To Play. */
  blurb: string;
  points: number;
  /** Emoji used in the spoiler-free share grid. */
  emoji: string;
  /** Single letter used in share codes (/s/12-mstnbhx-14). */
  code: string;
}

export const TIERS: Record<TierId, TierDef> = {
  main: {
    id: "main",
    label: "MAIN STAGE",
    blurb: "Everyone said it. You're still in the field.",
    points: 10,
    emoji: "⬜",
    code: "m",
  },
  tote: {
    id: "tote",
    label: "TOTE BAG",
    blurb: "The 'obscure' pick that everyone who thinks they're obscure picks.",
    points: 15,
    emoji: "👜",
    code: "t",
  },
  side: {
    id: "side",
    label: "SIDE STAGE",
    blurb: "Real fans know it.",
    points: 30,
    emoji: "🟦",
    code: "s",
  },
  tent: {
    id: "tent",
    label: "THE TENT",
    blurb: "Rare. You know your stuff.",
    points: 60,
    emoji: "🟩",
    code: "n",
  },
  basement: {
    id: "basement",
    label: "BASEMENT",
    blurb: "Very rare. Sweaty room, great sound system.",
    points: 85,
    emoji: "🟪",
    code: "b",
  },
  htbt: {
    id: "htbt",
    label: "YOU HAD TO BE THERE",
    blurb: "Almost nobody says this. The deepest cut.",
    points: 100,
    emoji: "🟨",
    code: "h",
  },
};

export const MISS = { label: "MISSED IT", emoji: "⬛", code: "x", points: 0 } as const;

export const START_DISTANCE = 700;
export const ROUNDS_PER_SET = 7;
export const DEFAULT_SECONDS = 25;
/** Network/clock slack the server allows past the visible deadline. */
export const GRACE_MS = 2500;

export function outcomePoints(o: Outcome): number {
  return o === "miss" ? 0 : TIERS[o].points;
}

export function outcomeEmoji(o: Outcome): string {
  return o === "miss" ? MISS.emoji : TIERS[o].emoji;
}

export function outcomeCode(o: Outcome): string {
  return o === "miss" ? MISS.code : TIERS[o].code;
}

export function outcomeFromCode(c: string): Outcome | null {
  if (c === MISS.code) return "miss";
  for (const id of TIER_IDS) if (TIERS[id].code === c) return id;
  return null;
}

/** Metres from the stage after a set of outcomes. Never below 0. */
export function distanceFor(outcomes: readonly Outcome[]): number {
  const pts = outcomes.reduce((sum, o) => sum + outcomePoints(o), 0);
  return Math.max(0, START_DISTANCE - pts);
}

/**
 * Rarity model thresholds, as estimated share of players giving an answer.
 * Used by the content compiler (lib/content/compile.ts) — not at runtime.
 * share >= main → MAIN STAGE, >= side → SIDE STAGE, ... below basement → HTBT.
 */
export const SHARE_THRESHOLDS = {
  main: 0.06,
  side: 0.015,
  tent: 0.004,
  basement: 0.0008,
} as const;

/** Nominal share an author's tier guess stands for (blended with fame). */
export const GUESS_SHARE: Record<Exclude<TierId, "tote">, number> = {
  main: 0.12,
  side: 0.03,
  tent: 0.008,
  basement: 0.002,
  htbt: 0.0004,
};
