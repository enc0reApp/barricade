/**
 * CONTENT CONTRACT.
 *
 * Two layers:
 *  1. SOURCE  — hand/agent-authored JSON in content/source/ (gitignored, spoilers).
 *               One file per prompt + one schedule file. See docs/CONTENT.md.
 *  2. PACK    — compiled by scripts/build-content.ts into a single ContentPack,
 *               which the server loads. Sealed (AES-GCM) into content/sealed/
 *               for the public repo. The public sample pack is unsealed.
 */

import type { TierId } from "../game/tiers";

/** What kind of thing an answer is. Prompts may accept several. */
export const ENTITY_TYPES = [
  "artist", // musicians, bands, DJs, producers, collectives that perform
  "city",
  "country",
  "genre", // genres, subgenres, scenes ("UK garage", "hyperpop")
  "festival",
  "venue", // clubs, arenas, amphitheatres, theatres, stadiums, warehouses
  "soundsystem", // pro-audio brands (Funktion-One) AND sound-system crews (Stone Love)
  "label", // record labels
  "gear", // instruments, drum machines, synths, DJ hardware
  "stage", // named stages/tents at festivals (Pyramid Stage, Sahara)
  "other", // anything else that is a proper noun (radio shows, events, brands)
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/* ───────────────────────────── SOURCE ───────────────────────────── */

/** Author's tier guess, or an editorial flag that forces a tier. */
export type SourceGuess = "main" | "side" | "tent" | "basement" | "htbt";

export interface SourceAnswer {
  /** Canonical display name, properly cased ("Fred again..", "Berghain", "Drum and bass"). */
  name: string;
  type: EntityType;
  /** Other spellings people will type. Do not repeat `name`. Normalisation already handles case, accents, punctuation, "the", "&". */
  aliases?: string[];
  /** English Wikipedia article title (underscores or spaces), or null if none exists. Used for fame (pageviews). */
  wiki: string | null;
  /** Author's estimate of how many players would give this answer. Required. */
  guess: SourceGuess;
  /**
   * Editorial overrides (rare):
   *  - "tote": the go-to "obscure" answer that isn't obscure → TOTE BAG (15)
   *  - "htbt": force YOU HAD TO BE THERE regardless of fame
   *  - "lock": use `guess` exactly; ignore fame (fame is misleading for this answer in this prompt)
   */
  flag?: "tote" | "htbt" | "lock";
  /** Optional one-line fact shown on the results screen ("Opened 2004 in a former power station"). Keep < 90 chars. */
  note?: string;
}

export interface SourcePrompt {
  /** kebab-case, unique, stable. File name is `<slug>.json`. */
  slug: string;
  /** The prompt as shown. Imperative, starts with "Name", < 70 chars ideally. */
  text: string;
  /** Optional small print under the prompt ("Any year. Defunct ones count."). */
  hint?: string;
  /** Which entity types this prompt accepts. */
  types: EntityType[];
  /** 1 (anyone can answer) … 5 (only heads). Used to order the daily set. */
  difficulty: 1 | 2 | 3 | 4 | 5;
  /** Precise membership rule the answer list was built against. Not shown to players. */
  boundary: string;
  /**
   * How rarity is computed:
   *  - "blend" (default): mix author guesses with Wikipedia fame
   *  - "guess": author guesses only (fame is a bad proxy here, e.g. cities in a niche context)
   *  - "fame": fame only (broad prompts where global fame ≈ what people say)
   */
  rarity?: "blend" | "guess" | "fame";
  /** Seconds on the clock. Default 25. */
  seconds?: number;
  answers: SourceAnswer[];
  /** Where the list came from. */
  sources: string[];
  /** Free-form notes for editors. */
  notes?: string;
}

export interface SourceScheduleDay {
  /** Puzzle number, 1-based. Date = epoch + (number - 1) days. */
  number: number;
  /** Optional theme title ("FESTIVAL SEASON", "UNDERGROUND"). */
  title?: string;
  /** Exactly 7 prompt slugs, in play order (easiest first). */
  prompts: string[];
}

export interface SourceSchedule {
  /** YYYY-MM-DD of puzzle #1. */
  epoch: string;
  days: SourceScheduleDay[];
}

/* ───────────────────────────── PACK ───────────────────────────── */

export interface PackAnswer {
  /** Stable entity id, `<type>:<slug>` e.g. "venue:berghain". */
  id: string;
  name: string;
  type: EntityType;
  tier: TierId;
  /** Estimated share of players giving this answer (0..1), from the rarity model. */
  share: number;
  /** Every lookup key (from normalize.matchKeys over name + aliases). */
  keys: string[];
  note?: string;
}

export interface PackPrompt {
  /** = source slug */
  id: string;
  text: string;
  hint?: string;
  types: EntityType[];
  difficulty: number;
  seconds: number;
  answers: PackAnswer[];
}

export interface PackPuzzle {
  number: number;
  /** YYYY-MM-DD */
  date: string;
  title?: string;
  prompts: PackPrompt[];
}

/** One row of the global index used to say "real, but not an answer here". */
export interface PackCatalogEntry {
  id: string;
  name: string;
  type: EntityType;
  keys: string[];
}

export interface ContentPack {
  format: 1;
  /** normalize.NORMALIZE_VERSION the keys were built with. */
  normalizeVersion: number;
  /** "sample" | "production" */
  kind: "sample" | "production";
  generatedAt: string;
  epoch: string;
  puzzles: PackPuzzle[];
  catalog: PackCatalogEntry[];
}
