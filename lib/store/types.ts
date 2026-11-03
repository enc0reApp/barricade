/**
 * Crowd-stats store. Key layout (docs/ARCHITECTURE.md). Every key starts with
 * a namespace, `b:{env}:{kind}` — the deployment env (VERCEL_ENV, else
 * NODE_ENV) and the pack kind — so Preview/dev plays and sample-pack plays
 * never land in production's numbers, even on a shared Redis database.
 *
 *   {ns}:{date}:p:{playerId}        string NX EX 3d    first-finish guard
 *   {ns}:{date}:s:{playerId}:{i}    string NX EX 3d    round start (ms): no clock restarts
 *   {ns}:{date}:a:{playerId}:{i}    string NX EX 3d    the round's one accepted answer + receipt
 *   {ns}:{date}:src:{ipHash}        counter EX 3d      counted finishes per client IP
 *   {ns}:{date}:plays               counter            finished players
 *   {ns}:{date}:distsum             counter            sum of distances
 *   {ns}:{date}:dist                hash distance→count   exact distance histogram
 *   {ns}:{date}:r{i}                hash answerId/"miss"→count
 *   {ns}:{date}:rej{i}              hash normalisedKey→count, ≤ 2000 fields, EX 30d (editors only)
 *   {ns}:{date}:fl:{playerId}:{i}   string NX EX 3d    one flag per player per round
 *   {ns}:{date}:flsrc:{ipHash}      counter EX 3d      flags per client IP
 *   {ns}:{date}:flags               list (capped 1000) "this should count" reports
 *
 * Implementations may throw; getStore() wraps them so failures never break
 * gameplay (errors are logged and neutral values returned).
 */

export type PackKind = "sample" | "production";

export const FIRST_FINISH_TTL_SECONDS = 259_200; // 3 days
/** Round start + accepted-answer keys live as long as a date can still be played. */
export const ROUND_STATE_TTL_SECONDS = 259_200;
/** Per-IP counters (finishes, flags). */
export const SOURCE_TTL_SECONDS = 259_200;
/** Counted finishes per client IP per date. Generous: festival wifi and offices share an IP. */
export const FINISHES_PER_SOURCE = 30;
/** Flags per client IP per date. */
export const FLAGS_PER_SOURCE = 20;
export const FLAGS_CAP = 1000;
/** Distinct rejected keys kept per round; keys already logged keep counting past the cap. */
export const REJECTED_FIELDS_CAP = 2000;
export const REJECTED_TTL_SECONDS = 2_592_000; // 30 days
export const MISS_FIELD = "miss";

/** The env vars the namespace reads (process.env by default). */
export type StatsEnvVars = { readonly VERCEL_ENV?: string | undefined; readonly NODE_ENV?: string | undefined };

/** The deployment env used in the key namespace: VERCEL_ENV (production/preview/development), else NODE_ENV. */
export function statsEnv(env: StatsEnvVars = process.env): string {
  const raw = (env.VERCEL_ENV || env.NODE_ENV || "development").toLowerCase();
  return /^[a-z0-9-]{1,32}$/.test(raw) ? raw : "other";
}

/** `b:{env}:{kind}` — the prefix of every key a store for this pack kind writes. */
export function statsNamespace(kind: PackKind, env: StatsEnvVars = process.env): string {
  return `b:${statsEnv(env)}:${kind}`;
}

export function keysFor(ns: string) {
  return {
    player: (date: string, playerId: string) => `${ns}:${date}:p:${playerId}`,
    start: (date: string, playerId: string, i: number) => `${ns}:${date}:s:${playerId}:${i}`,
    accept: (date: string, playerId: string, i: number) => `${ns}:${date}:a:${playerId}:${i}`,
    source: (date: string, source: string) => `${ns}:${date}:src:${source}`,
    plays: (date: string) => `${ns}:${date}:plays`,
    distSum: (date: string) => `${ns}:${date}:distsum`,
    dist: (date: string) => `${ns}:${date}:dist`,
    round: (date: string, i: number) => `${ns}:${date}:r${i}`,
    rejected: (date: string, i: number) => `${ns}:${date}:rej${i}`,
    flagGuard: (date: string, playerId: string, i: number) => `${ns}:${date}:fl:${playerId}:${i}`,
    flagSource: (date: string, source: string) => `${ns}:${date}:flsrc:${source}`,
    flags: (date: string) => `${ns}:${date}:flags`,
  };
}
export type StoreKeys = ReturnType<typeof keysFor>;

export interface FinishRecord {
  distance: number;
  /** Accepted answer id per round, null for a miss. */
  answers: (string | null)[];
}

export interface FinishOutcome {
  /** False for a repeat finish by the same player (nothing written). */
  first: boolean;
  /** True when the play was added to the crowd numbers (false past the per-IP cap). */
  counted: boolean;
}

export interface FlagRecord {
  i: number;
  text: string;
  p: string;
  /** Epoch ms. */
  at: number;
}

/** Everything the finish + crowd endpoints need for one date, read in one go. */
export interface DateStats {
  plays: number;
  distSum: number;
  /** distance (metres) → players. */
  hist: Map<number, number>;
  /** per round: answerId / "miss" → players. */
  rounds: Map<string, number>[];
}

export interface Store {
  /** "none" = production without Redis: records nothing, so crowd stats stay hidden rather than per-instance noise. */
  readonly kind: "memory" | "upstash" | "none";
  /** Key namespace (statsNamespace) this store reads and writes. */
  readonly ns: string;
  /**
   * The first start of a player's round wins (SET NX): returns the start time
   * that stands, so asking for the same round again never restarts its clock.
   */
  claimRoundStart(date: string, playerId: string, i: number, startMs: number): Promise<number>;
  /**
   * The first accepted answer of a player's round wins (SET NX): returns the
   * stored value — `value` itself on the first call, the original afterwards.
   */
  claimAccepted(date: string, playerId: string, i: number, value: string): Promise<string>;
  /**
   * Records a finished set once per player per date, atomically. `source` is
   * a hashed client IP: past FINISHES_PER_SOURCE counted finishes from one
   * source on a date, the guard is still set but nothing is counted.
   */
  recordFinish(date: string, playerId: string, rec: FinishRecord, source?: string | null): Promise<FinishOutcome>;
  getPlays(date: string): Promise<number>;
  getDistanceSum(date: string): Promise<number>;
  getDistanceHist(date: string): Promise<Map<number, number>>;
  getRoundCounts(date: string, i: number): Promise<Map<string, number>>;
  /** plays + distsum + hist + `rounds` round hashes in one request. */
  getStats(date: string, rounds: number): Promise<DateStats>;
  /** Capped (REJECTED_FIELDS_CAP new fields per round) and expiring (REJECTED_TTL_SECONDS). */
  logRejected(date: string, i: number, key: string): Promise<void>;
  /** At most one flag per player per round, and FLAGS_PER_SOURCE per hashed client IP per date. */
  logFlag(date: string, flag: FlagRecord, source?: string | null): Promise<void>;
}

export function emptyStats(rounds: number): DateStats {
  return { plays: 0, distSum: 0, hist: new Map(), rounds: Array.from({ length: Math.max(0, rounds) }, () => new Map()) };
}
