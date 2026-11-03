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
 *   - finished           → the ticket (or, once compacted, a ticket built from its summary)
 *
 * Several tabs share the key. Reads are cached per tab (dropped when another
 * tab writes, via the 'storage' event); every write re-reads storage first and
 * changes only its own piece, and a stale tab can never move a game backwards.
 */

import type { AcceptedAnswer, FinishResult, RoundPrompt } from "../api/contract";
import { addDays } from "../game/day";
import { GRACE_MS, type Outcome } from "../game/tiers";

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
  /**
   * The player id this game's tokens and receipts were issued to. Kept per game
   * so a top-level id adopted from another tab can never orphan its receipts.
   * Older games lack it and use the top-level id.
   */
  playerId?: string;
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

/**
 * Parses whatever is in storage. Anything unusable becomes a fresh state (keeping a valid playerId).
 * `fallbackId` replaces a missing or invalid playerId instead of minting a new one.
 */
export function parseState(raw: string | null, fallbackId?: string): StoredState {
  const mint = () => fallbackId ?? generatePlayerId();
  if (!raw) return freshState(mint());
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return freshState(mint());
  }
  if (!isObject(data)) return freshState(mint());
  const playerId = isLongPlayerId(data.playerId) ? data.playerId : mint();
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

function isLongPlayerId(x: unknown): x is string {
  return typeof x === "string" && PLAYER_ID_RE.test(x) && x.length >= 16;
}

function isStoredGame(x: unknown): x is StoredGame {
  if (!isObject(x)) return false;
  return (
    typeof x.number === "number" &&
    typeof x.date === "string" &&
    (x.mode === "today" || x.mode === "archive") &&
    (x.status === "playing" || x.status === "finished") &&
    typeof x.total === "number" &&
    Array.isArray(x.rounds) &&
    (x.playerId === undefined || isLongPlayerId(x.playerId))
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
  | { kind: "ticket" }
  /** Finished, but compacted: only the summary is left (see summaryFinish). Never the doors. */
  | { kind: "summary" };

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

/** Where to pick a game back up. Call settleExpired first. A finished game is terminal. */
export function resumePoint(game: StoredGame | null | undefined): ResumePoint {
  if (!game) return { kind: "doors" };
  if (game.status === "finished") return game.finish ? { kind: "ticket" } : { kind: "summary" };
  if (game.rounds.length === 0) return { kind: "doors" };
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

/** The round tokens /api/finish needs as proof of play: one per round ("" for a round never started). */
export function tokensOf(game: StoredGame): string[] {
  const out: string[] = new Array<string>(game.total).fill("");
  for (const r of game.rounds) if (r.index >= 0 && r.index < game.total) out[r.index] = r.token;
  return out;
}

/** What /api/round needs to start round `index` (> 0): the previous round's token, plus its receipt (null = missed). */
export function prevProof(game: StoredGame, index: number): { prevToken?: string; prevReceipt?: string | null } {
  if (index <= 0) return {};
  const prev = game.rounds.find((r) => r.index === index - 1);
  if (!prev) return {};
  return { prevToken: prev.token, prevReceipt: prev.receipt ?? null };
}

/** Extra margin on the server-clock waits below (clock jitter; the offset already errs late). */
export const PROOF_PAD_MS = 250;

/** ms (client clock) until `serverMs` has passed on the server for a round measured with `offset`. */
function untilServer(serverMs: number, offset: number, clientNow: number): number {
  return Math.max(0, serverMs - (clientNow + offset));
}

/**
 * How long to wait before asking /api/round for round `index`: a round after a
 * miss may only start once the missed round's answer window (deadline +
 * GRACE_MS) has closed on the server.
 */
export function roundWaitMs(game: StoredGame, index: number, clientNow: number): number {
  if (index <= 0) return 0;
  const prev = game.rounds.find((r) => r.index === index - 1);
  if (!prev || prev.receipt) return 0;
  return untilServer(prev.deadline + GRACE_MS + PROOF_PAD_MS, prev.offset, clientNow);
}

/**
 * How long to wait before /api/finish: the server only reveals a set once every
 * missed round is past its deadline + GRACE_MS (no answering after seeing the picks).
 */
export function finishWaitMs(game: StoredGame, clientNow: number): number {
  let wait = 0;
  for (const r of game.rounds) {
    if (r.receipt) continue;
    wait = Math.max(wait, untilServer(r.deadline + GRACE_MS + PROOF_PAD_MS, r.offset, clientNow));
  }
  return wait;
}

/**
 * How far along a game is, for refusing stale writes from another tab:
 * finished beats playing; otherwise settled rounds count 2 and an open round 1.
 */
export function progressOf(game: StoredGame | null | undefined): number {
  if (!game) return -1;
  if (game.status === "finished") return Number.MAX_SAFE_INTEGER;
  let n = 0;
  for (const r of game.rounds) n += r.outcome !== undefined ? 2 : 1;
  return n;
}

/**
 * What to store when `incoming` is written over `stored` (same date).
 * Finished is terminal: the first finish is the record of play and only its
 * flags can grow. A playing game never replaces one that is further along.
 */
export function mergeGame(stored: StoredGame | null | undefined, incoming: StoredGame): StoredGame {
  if (!stored || stored === incoming) return incoming;
  if (stored.status === "finished") {
    if (incoming.status !== "finished") return stored;
    const flagged = [...new Set([...(stored.flagged ?? []), ...(incoming.flagged ?? [])])].sort((a, b) => a - b);
    // A stored game may already be compacted (no `finish`) while the screen still holds the full
    // reveal; keep it, or the first flag would swap the ticket to its summary.
    const finish = stored.finish ?? incoming.finish;
    if (flagged.length === (stored.flagged ?? []).length && finish === stored.finish) return stored;
    return { ...stored, flagged, ...(finish ? { finish } : {}) };
  }
  if (incoming.status === "finished") return incoming;
  return progressOf(stored) > progressOf(incoming) ? stored : incoming;
}

/** A game with round `index` marked as flagged. */
export function withFlag(game: StoredGame, index: number): StoredGame {
  const flagged = [...new Set([...(game.flagged ?? []), index])].sort((a, b) => a - b);
  return { ...game, flagged };
}

/**
 * A ticket for a finished game whose full reveal has been compacted away:
 * outcomes and distance from its summary, no rounds, no crowd numbers.
 * Never re-fetch these (compacted games keep no receipts).
 */
export function summaryFinish(game: StoredGame): FinishResult | null {
  if (game.status !== "finished") return null;
  if (game.finish) return game.finish;
  if (!game.summary) return null;
  return {
    ok: true,
    number: game.number,
    date: game.date,
    mode: game.mode,
    outcomes: game.summary.outcomes,
    distance: game.summary.distance,
    rounds: [],
    crowd: { plays: null, beatPct: null },
  };
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
      ...(g.flagged ? { flagged: g.flagged } : {}),
      ...(g.playerId ? { playerId: g.playerId } : {}),
    };
  });
  return out;
}

/* ───────────────────────────── the store ───────────────────────────── */

export interface Store {
  read(): StoredState;
  playerId(): string;
  game(date: string): StoredGame | null;
  /**
   * Saves one game, merged onto what storage holds now (see mergeGame).
   * Returns what was stored: not `game` itself when another tab got further.
   */
  putGame(game: StoredGame): StoredGame;
  /**
   * Records a finished game (summary + streak). If that date is already
   * finished (another tab), keeps the original and returns it unchanged.
   */
  finishGame(game: StoredGame, finish: FinishResult): { game: StoredGame; streak: Streak };
  streak(): Streak;
  settings(): Settings;
  putSettings(patch: Partial<Settings>): void;
  /** True when writes are reaching real storage. */
  persistent(): boolean;
  /** Drops the cached copy so the next read comes from storage. */
  refresh(): void;
  /** Another tab changed the key: refresh, then tell subscribers. */
  externalChange(): void;
  /** Called after another tab changes the key. Returns an unsubscribe. */
  subscribe(cb: () => void): () => void;
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
  const listeners = new Set<() => void>();

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

  /** The state as storage holds it right now (another tab may have written), for read-modify-write. */
  const fresh = (): StoredState => {
    if (!backend) return load();
    let raw: string | null;
    try {
      raw = backend.getItem(key);
    } catch {
      backend = null;
      return load();
    }
    // Nothing stored (cleared, or never persisted): carry on from what this tab knows.
    if (raw === null) return load();
    memory = parseState(raw, memory?.playerId);
    return memory;
  };

  return {
    read: load,
    playerId: () => load().playerId,
    game: (date) => load().games[date] ?? null,
    putGame(game) {
      const s = fresh();
      const stored = s.games[game.date];
      const next = mergeGame(stored, game);
      if (next !== stored) write({ ...s, games: compactGames({ ...s.games, [game.date]: next }) });
      return next;
    },
    finishGame(game, finish) {
      const s = fresh();
      const stored = s.games[game.date];
      if (stored?.status === "finished") return { game: stored, streak: s.streak };
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
      const s = fresh();
      write({ ...s, settings: { ...s.settings, ...patch } });
    },
    persistent: () => backend !== null,
    refresh() {
      memory = null;
    },
    externalChange() {
      memory = null;
      for (const cb of [...listeners]) cb();
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

let shared: Store | null = null;
let sharedKey: string | null = null;
let listening = false;

/** The page-wide store. Mock mode uses its own key so fake tokens never leak into real play. */
export function getStore(mock = false): Store {
  const key = mock ? `${STORAGE_KEY}:mock` : STORAGE_KEY;
  if (!shared || sharedKey !== key) {
    shared = createStore({ key });
    sharedKey = key;
  }
  if (!listening && typeof window !== "undefined") {
    listening = true;
    // Fires in every OTHER tab of this origin when one writes (key null = storage cleared).
    window.addEventListener("storage", (e) => {
      if (shared && (e.key === null || e.key === sharedKey)) shared.externalChange();
    });
  }
  return shared;
}
