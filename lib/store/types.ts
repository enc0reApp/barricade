/**
 * Crowd-stats store. Key layout (docs/ARCHITECTURE.md), all per date:
 *
 *   b:{date}:p:{playerId}  string NX EX 259200   first-finish guard
 *   b:{date}:plays         counter               finished players
 *   b:{date}:distsum       counter               sum of distances
 *   b:{date}:dist          hash distance→count   exact distance histogram
 *   b:{date}:r{i}          hash answerId/"miss"→count
 *   b:{date}:rej{i}        hash normalisedKey→count (editors only)
 *   b:{date}:flags         list (capped 1000)    "this should count" reports
 *
 * Implementations may throw; getStore() wraps them so failures never break
 * gameplay (errors are logged and neutral values returned).
 */

export const FIRST_FINISH_TTL_SECONDS = 259_200; // 3 days
export const FLAGS_CAP = 1000;
export const MISS_FIELD = "miss";

export const keys = {
  player: (date: string, playerId: string) => `b:${date}:p:${playerId}`,
  plays: (date: string) => `b:${date}:plays`,
  distSum: (date: string) => `b:${date}:distsum`,
  dist: (date: string) => `b:${date}:dist`,
  round: (date: string, i: number) => `b:${date}:r${i}`,
  rejected: (date: string, i: number) => `b:${date}:rej${i}`,
  flags: (date: string) => `b:${date}:flags`,
};

export interface FinishRecord {
  distance: number;
  /** Accepted answer id per round, null for a miss. */
  answers: (string | null)[];
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
  /** Records a finished set once per player per date. `first` is false for repeat finishes. */
  recordFinish(date: string, playerId: string, rec: FinishRecord): Promise<{ first: boolean }>;
  getPlays(date: string): Promise<number>;
  getDistanceSum(date: string): Promise<number>;
  getDistanceHist(date: string): Promise<Map<number, number>>;
  getRoundCounts(date: string, i: number): Promise<Map<string, number>>;
  /** plays + distsum + hist + `rounds` round hashes in one request. */
  getStats(date: string, rounds: number): Promise<DateStats>;
  logRejected(date: string, i: number, key: string): Promise<void>;
  logFlag(date: string, flag: FlagRecord): Promise<void>;
}

export function emptyStats(rounds: number): DateStats {
  return { plays: 0, distSum: 0, hist: new Map(), rounds: Array.from({ length: Math.max(0, rounds) }, () => new Map()) };
}
