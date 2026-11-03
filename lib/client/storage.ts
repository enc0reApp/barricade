/**
 * Client persistence: one localStorage key, versioned, every access guarded.
 *
 * If storage is missing, full, or throws (private mode, blocked cookies), the
 * store keeps working in memory for the life of the page.
 *
 * Shape (key "barricade:v1"):
 *   { version: 1, playerId, games: { [date]: StoredGame }, streak, settings }
 *
 * The resume rules live here as pure functions so they can be tested:
 *   - reload mid-round   → same token if before the deadline, else that round is a miss
 *   - reload mid-reveal  → the reveal's end state (tier card + KEEP PUSHING)
 *   - finished           → the ticket
 */

import type { AcceptedAnswer, FinishResult, RoundPrompt } from "../api/contract";
import { addDays } from "../game/day";
import type { Outcome } from "../game/tiers";

export const STORAGE_KEY = "barricade:v1";
export const STORAGE_VERSION = 1;
/** Rejected tries remembered per round (for the "should this have counted?" link). */
export const MAX_TRIES = 5;
/** Finished games older than this many (by date) keep only their summary. */
export const KEEP_FULL_GAMES = 21;

export const PLAYER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export interface StoredRound {
  index: number;
  token: string;
  /** Epoch ms, server clock. */
  deadline: number;
  prompt: RoundPrompt;
  /** serverNow − Date.now() measured when the round started. */
  offset: number;
  outcome?: Outcome;
  answer?: AcceptedAnswer;
  /** Signed receipt for an accepted answer; null for a miss. */
  receipt?: string | null;
  /** Last rejected tries, oldest first. */
  tries: string[];
}

export type GameMode = "today" | "archive";

export interface StoredGame {
  number: number;
  date: string;
  mode: GameMode;
  status: "playing" | "finished";
  /** Rounds in the set (7). */
  total: number;
  rounds: StoredRound[];
  finish?: FinishResult;
  /** Compact result kept forever (archive list), set when finished. */
  summary?: { outcomes: Outcome[]; distance: number };
  /** Round indexes already flagged ("should this have counted?"). */
  flagged?: number[];
}

export interface Streak {
  current: number;
  best: number;
  /** Local date of the last today-mode finish that counted. */
  lastDate: string | null;
}

export interface Settings {
  /** Has the player opened How To Play / dismissed the first-run hint. */
  seenHow?: boolean;
}

export interface StoredState {
  version: typeof STORAGE_VERSION;
  playerId: string;
  games: Record<string, StoredGame>;
  streak: Streak;
  settings: Settings;
}

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/* ───────────────────────────── pure rules ───────────────────────────── */

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

/** 22 url-safe characters (~132 bits). Uses crypto when available. */
export function generatePlayerId(randomBytes?: (n: number) => Uint8Array): string {
  const n = 22;
  let bytes: Uint8Array;
  if (randomBytes) bytes = randomBytes(n);
  else if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    bytes = crypto.getRandomValues(new Uint8Array(n));
  } else {
    bytes = new Uint8Array(n).map(() => Math.floor(Math.random() * 256));
  }
  let out = "";
  for (let i = 0; i < n; i++) out += ID_ALPHABET[(bytes[i] ?? 0) & 63];
  return out;
}

export function freshState(playerId: string = generatePlayerId()): StoredState {
  return {
    version: STORAGE_VERSION,
    playerId,
    games: {},
    streak: { current: 0, best: 0, lastDate: null },
    settings: {},
  };
}

/** Parses whatever is in storage. Anything unusable becomes a fresh state (keeping a valid playerId). */
export function parseState(raw: string | null): StoredState {
  if (!raw) return freshState();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return freshState();
  }
  if (!isObject(data)) return freshState();
  const playerId = typeof data.playerId === "string" && PLAYER_ID_RE.test(data.playerId) && data.playerId.length >= 16
    ? data.playerId
    : generatePlayerId();
  if (data.version !== STORAGE_VERSION) return freshState(playerId);
  const state = freshState(playerId);
  if (isObject(data.games)) {
    for (const [date, g] of Object.entries(data.games)) {
      if (isStoredGame(g)) state.games[date] = g;
    }
  }
  if (isObject(data.streak)) {
    const s = data.streak;
    state.streak = {
      current: typeof s.current === "number" && s.current >= 0 ? Math.floor(s.current) : 0,
      best: typeof s.best === "number" && s.best >= 0 ? Math.floor(s.best) : 0,
      lastDate: typeof s.lastDate === "string" ? s.lastDate : null,
    };
  }
  if (isObject(data.settings)) state.settings = { seenHow: data.settings.seenHow === true };
  return state;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isStoredGame(x: unknown): x is StoredGame {
  if (!isObject(x)) return false;
  return (
    typeof x.number === "number" &&
    typeof x.date === "string" &&
    (x.mode === "today" || x.mode === "archive") &&
    (x.status === "playing" || x.status === "finished") &&
    typeof x.total === "number" &&
    Array.isArray(x.rounds)
  );
}

/** Adds a rejected try, keeping the last MAX_TRIES (a repeat moves to the end). */
export function pushTry(tries: readonly string[], text: string): string[] {
  const t = text.trim();
  if (!t) return [...tries];
  const out = tries.filter((x) => x.toLowerCase() !== t.toLowerCase());
  out.push(t);
  return out.slice(-MAX_TRIES);
}

/**
 * Streak after a finish. Only today-mode finishes count; consecutive local
 * dates extend it; the same date never double-counts; a gap restarts at 1.
 */
export function applyStreak(streak: Streak, date: string, mode: GameMode): Streak {
  if (mode !== "today") return streak;
  if (streak.lastDate === date) return streak;
  if (streak.lastDate && date < streak.lastDate) return streak; // never rewind
  const current = streak.lastDate && addDays(streak.lastDate, 1) === date ? streak.current + 1 : 1;
  return { current, best: Math.max(streak.best, current), lastDate: date };
}

/** The streak as it stands on `today`: still alive if the last counted finish was today or yesterday. */
export function liveStreak(streak: Streak, today: string): number {
  if (!streak.lastDate) return 0;
  if (streak.lastDate === today || addDays(streak.lastDate, 1) === today) return streak.current;
  return 0;
}

export type ResumePoint =
  | { kind: "doors" }
  | { kind: "round"; index: number }
  | { kind: "reveal"; index: number }
  | { kind: "finishing" }
  | { kind: "ticket" };

/**
 * Marks the open round as a miss if its clock has run out. `clientNow` is
 * Date.now(); each round carries its own server-clock offset.
 * Returns the same object when nothing changed.
 */
export function settleExpired(game: StoredGame, clientNow: number): StoredGame {
  const last = game.rounds[game.rounds.length - 1];
  if (!last || last.outcome !== undefined || game.status === "finished") return game;
  if (last.deadline - (clientNow + last.offset) > 0) return game;
  const rounds = game.rounds.slice(0, -1);
  rounds.push({ ...last, outcome: "miss", receipt: null });
  return { ...game, rounds };
}

/** Where to pick a game back up. Call settleExpired first. */
export function resumePoint(game: StoredGame | null | undefined): ResumePoint {
  if (!game || game.rounds.length === 0) return game?.status === "finished" && game.finish ? { kind: "ticket" } : { kind: "doors" };
  if (game.status === "finished" && game.finish) return { kind: "ticket" };
  const last = game.rounds[game.rounds.length - 1]!;
  if (last.outcome === undefined) return { kind: "round", index: last.index };
  if (last.index >= game.total - 1) return { kind: "finishing" };
  return { kind: "reveal", index: last.index };
}

/** Outcomes so far, in round order. */
export function outcomesOf(game: StoredGame): Outcome[] {
  return game.rounds.filter((r) => r.outcome !== undefined).map((r) => r.outcome as Outcome);
}

/** The receipts /api/finish needs: one per round, null for a miss or an unplayed round. */
export function receiptsOf(game: StoredGame): (string | null)[] {
  const out: (string | null)[] = new Array<string | null>(game.total).fill(null);
  for (const r of game.rounds) if (r.index >= 0 && r.index < game.total) out[r.index] = r.receipt ?? null;
  return out;
}

/** Drops bulky detail from old finished games so storage never fills up. */
export function compactGames(games: Record<string, StoredGame>, keep = KEEP_FULL_GAMES): Record<string, StoredGame> {
  const dates = Object.keys(games).sort().reverse();
  const out: Record<string, StoredGame> = {};
  dates.forEach((date, i) => {
    const g = games[date]!;
    if (i < keep || g.status !== "finished") {
      out[date] = g;
      return;
    }
    out[date] = {
      number: g.number,
      date: g.date,
      mode: g.mode,
      status: g.status,
      total: g.total,
      rounds: [],
      summary: g.summary ?? (g.finish ? { outcomes: g.finish.outcomes, distance: g.finish.distance } : undefined),
    };
  });
  return out;
}

/* ───────────────────────────── the store ───────────────────────────── */

export interface Store {
  read(): StoredState;
  playerId(): string;
  game(date: string): StoredGame | null;
  putGame(game: StoredGame): StoredGame;
  /** Records a finished game (summary + streak). Returns the updated streak. */
  finishGame(game: StoredGame, finish: FinishResult): { game: StoredGame; streak: Streak };
  streak(): Streak;
  settings(): Settings;
  putSettings(patch: Partial<Settings>): void;
  /** True when writes are reaching real storage. */
  persistent(): boolean;
}

function defaultBackend(): KV | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createStore(opts: { key?: string; backend?: KV | null } = {}): Store {
  const key = opts.key ?? STORAGE_KEY;
  let backend: KV | null = opts.backend === undefined ? defaultBackend() : opts.backend;
  let memory: StoredState | null = null;

  const load = (): StoredState => {
    if (memory) return memory;
    let raw: string | null = null;
    try {
      raw = backend ? backend.getItem(key) : null;
    } catch {
      backend = null;
    }
    memory = parseState(raw);
    // Persist a newly minted playerId straight away so it survives reloads.
    if (raw === null) write(memory);
    return memory;
  };

  const write = (state: StoredState) => {
    memory = state;
    if (!backend) return;
    try {
      backend.setItem(key, JSON.stringify(state));
    } catch {
      // Quota or blocked: compact hard and try once more, else stay in memory.
      try {
        const slim = { ...state, games: compactGames(state.games, 3) };
        backend.setItem(key, JSON.stringify(slim));
        memory = slim;
      } catch {
        backend = null;
      }
    }
  };

  return {
    read: load,
    playerId: () => load().playerId,
    game: (date) => load().games[date] ?? null,
    putGame(game) {
      const s = load();
      write({ ...s, games: compactGames({ ...s.games, [game.date]: game }) });
      return game;
    },
    finishGame(game, finish) {
      const s = load();
      const done: StoredGame = {
        ...game,
        status: "finished",
        finish,
        summary: { outcomes: finish.outcomes, distance: finish.distance },
      };
      const streak = applyStreak(s.streak, game.date, finish.mode === "today" && game.mode === "today" ? "today" : "archive");
      write({ ...s, streak, games: compactGames({ ...s.games, [game.date]: done }) });
      return { game: done, streak };
    },
    streak: () => load().streak,
    settings: () => load().settings,
    putSettings(patch) {
      const s = load();
      write({ ...s, settings: { ...s.settings, ...patch } });
    },
    persistent: () => backend !== null,
  };
}

let shared: Store | null = null;
let sharedKey: string | null = null;

/** The page-wide store. Mock mode uses its own key so fake tokens never leak into real play. */
export function getStore(mock = false): Store {
  const key = mock ? `${STORAGE_KEY}:mock` : STORAGE_KEY;
  if (!shared || sharedKey !== key) {
    shared = createStore({ key });
    sharedKey = key;
  }
  return shared;
}
