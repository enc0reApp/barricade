/**
 * HTTP API CONTRACT between the client (components/, lib/client/) and the
 * route handlers (app/api/). JSON in, JSON out. All POST bodies are JSON.
 *
 * Answers never reach the client before the player has finished a set.
 * The server owns the clock: a round's token records when it started.
 */

import type { EntityType } from "../content/types";
import type { Outcome, TierId } from "../game/tiers";

export type ApiError =
  | "bad-request"
  | "bad-date" // malformed date
  | "future" // date is not live anywhere yet (no spoilers)
  | "no-set" // no puzzle scheduled for this date
  | "bad-token" // signature / shape invalid
  | "bad-receipt"
  | "server";

export interface ApiFail {
  ok: false;
  error: ApiError;
  message?: string;
}

/* GET /api/set?date=YYYY-MM-DD ───────────────────────────────────── */

export interface SetInfo {
  ok: true;
  number: number;
  date: string;
  title?: string;
  /** Always 7 today, but read it rather than assuming. */
  rounds: number;
  /** Seconds on the clock for each round. */
  seconds: number[];
  /** "today" = scored, counts toward streak + crowd stats. "archive" = practice. */
  mode: "today" | "archive";
  /** "sample" when the server has no unsealed production pack (dev). */
  pack: "sample" | "production";
  /** Latest playable set number right now (for archive lists). */
  latestNumber: number;
  epoch: string;
}
/** A no-set reply also carries the archive bounds (tonight has no set, but earlier ones may exist). */
export type SetResponse = SetInfo | (ApiFail & { epoch?: string; latestNumber?: number });

/* POST /api/round ─────────────────────────────────────────────────── */

export interface RoundRequest {
  date: string;
  /** 0-based round index. */
  index: number;
  playerId: string;
  /**
   * Proof that round index-1 is over (required for index > 0 in "today" mode):
   * its round token, plus its receipt if it was answered. Without a receipt the
   * previous round's clock must have run out. Stops a script from opening all
   * seven rounds at once.
   */
  prevToken?: string;
  prevReceipt?: string | null;
}

export interface RoundPrompt {
  index: number;
  total: number;
  text: string;
  hint?: string;
  types: EntityType[];
  seconds: number;
}

export interface RoundStarted {
  ok: true;
  prompt: RoundPrompt;
  /** Opaque, signed. Send back with every answer for this round. */
  token: string;
  /** Epoch ms when the round closes (server clock). */
  deadline: number;
  /** Server's Date.now() when responding — lets the client correct clock skew. */
  serverNow: number;
}
export type RoundResponse = RoundStarted | ApiFail;

/* POST /api/answer ────────────────────────────────────────────────── */

export interface AnswerRequest {
  token: string;
  /** What the player typed. Server trims and caps length (80 chars). */
  text: string;
}

export interface AcceptedAnswer {
  id: string;
  name: string;
  type: EntityType;
  tier: TierId;
  points: number;
  /** Estimated share of players giving this answer (0..1). */
  share: number;
  note?: string;
}

export type AnswerResult =
  | {
      ok: true;
      status: "accepted";
      answer: AcceptedAnswer;
      /** Opaque, signed proof of this outcome. Keep it; send to /api/finish. */
      receipt: string;
    }
  | {
      ok: true;
      status: "rejected";
      /**
       * unknown   — not in this prompt's list and not a thing we recognise
       * offprompt — a real thing we know (canonical given), just not an answer to THIS prompt
       * empty     — nothing usable typed
       */
      reason: "unknown" | "offprompt" | "empty";
      canonical?: { name: string; type: EntityType };
    }
  | { ok: true; status: "expired" };
export type AnswerResponse = AnswerResult | ApiFail;

/* POST /api/finish ────────────────────────────────────────────────── */

export interface FinishRequest {
  date: string;
  playerId: string;
  /** One per round, in order. null = missed round. */
  receipts: (string | null)[];
  /**
   * The round tokens, one per round, in order (required in "today" mode).
   * Proof of play: every round must have been started by this player, and a
   * round with a null receipt must have run out of time. Without this, one
   * request with seven nulls would reveal the set's answers.
   */
  tokens?: string[];
}

export interface RevealPick {
  name: string;
  type: EntityType;
  tier: TierId;
  share: number;
  note?: string;
}

export interface RevealRound {
  index: number;
  text: string;
  hint?: string;
  yours: (AcceptedAnswer & { /** Real % of today's crowd who gave it, when known. */ crowdPct: number | null }) | null;
  /** A curated spread of answers across tiers — "you could have said…". */
  picks: RevealPick[];
  /** How many answers this prompt accepts in total. */
  total: number;
}

export interface FinishResult {
  ok: true;
  number: number;
  date: string;
  mode: "today" | "archive";
  outcomes: Outcome[];
  distance: number;
  rounds: RevealRound[];
  crowd: {
    /** Players who have finished this set so far (today mode), else null. */
    plays: number | null;
    /** % of finished players you beat (closer to the stage), else null. */
    beatPct: number | null;
  };
}
export type FinishResponse = FinishResult | ApiFail;

/* POST /api/flag  — "this should count" ───────────────────────────── */

export interface FlagRequest {
  date: string;
  index: number;
  text: string;
  playerId: string;
}
export type FlagResponse = { ok: true } | ApiFail;

/* GET /api/crowd?date=YYYY-MM-DD — the Morning After ─────────────── */

export interface CrowdRound {
  index: number;
  text: string;
  /** Most-given answers with real percentages. */
  top: { name: string; tier: TierId; pct: number }[];
  /** Accepted answers given by exactly one player. */
  singles: number;
  /** A few of those lone answers (canonical names only — never raw typed text). */
  singleNames: string[];
  /** % of players who missed this round. */
  missPct: number;
}

export type CrowdResponse =
  | {
      ok: true;
      number: number;
      date: string;
      title?: string;
      plays: number;
      avgDistance: number | null;
      /** Players per 50m bucket: [0–49, 50–99, …, 650–700]. Length 15. */
      distribution: number[];
      rounds: CrowdRound[];
    }
  | { ok: false; error: "not-yet"; opensAt: number; /** Server clock, so a skewed device can count down correctly. */ serverNow?: number }
  | ApiFail;
