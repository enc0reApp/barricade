/**
 * Upstash Redis over its REST API (no client dependency).
 *
 *   POST {url}/pipeline   body: [["CMD", "arg", ...], ...]
 *   Authorization: Bearer {token}
 *   → [{ "result": ... } | { "error": "..." }, ...]
 *
 * Env: KV_REST_API_URL + KV_REST_API_TOKEN (Vercel Marketplace naming) or
 * UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
 */

import {
  FINISHES_PER_SOURCE,
  FIRST_FINISH_TTL_SECONDS,
  FLAGS_CAP,
  FLAGS_PER_SOURCE,
  keysFor,
  MISS_FIELD,
  REJECTED_FIELDS_CAP,
  REJECTED_TTL_SECONDS,
  ROUND_STATE_TTL_SECONDS,
  SOURCE_TTL_SECONDS,
  type DateStats,
  type FinishOutcome,
  type FinishRecord,
  type FlagRecord,
  type Store,
  type StoreKeys,
} from "./types";

/**
 * First-finish guard + per-IP cap + every counter in ONE atomic script, so a
 * lost or failed request can never leave the guard set without the play.
 *   KEYS: 1 guard, 2 source counter, 3 plays, 4 distsum, 5 dist, 6.. round hashes
 *   ARGV: 1 guard TTL, 2 source TTL, 3 source cap (0 = no source), 4 distance, 5.. answer field per round
 *   → 0 repeat finish, 1 counted, 2 first finish but over the source cap (not counted)
 */
export const RECORD_FINISH_LUA = `
if not redis.call('SET', KEYS[1], '1', 'NX', 'EX', ARGV[1]) then return 0 end
local cap = tonumber(ARGV[3])
if cap > 0 then
  local n = redis.call('INCR', KEYS[2])
  if n == 1 then redis.call('EXPIRE', KEYS[2], ARGV[2]) end
  if n > cap then return 2 end
end
redis.call('INCR', KEYS[3])
redis.call('INCRBY', KEYS[4], ARGV[4])
redis.call('HINCRBY', KEYS[5], ARGV[4], 1)
for i = 6, #KEYS do redis.call('HINCRBY', KEYS[i], ARGV[i - 1], 1) end
return 1`;

/**
 * Rejected-try log with a field cap (keys already present keep counting) and
 * a TTL set once, on the first write.
 *   KEYS: 1 hash   ARGV: 1 field, 2 field cap, 3 TTL
 */
export const LOG_REJECTED_LUA = `
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1 or redis.call('HLEN', KEYS[1]) < tonumber(ARGV[2]) then
  redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
  if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
  return 1
end
return 0`;

/**
 * One flag per player per round, a per-IP cap, then the capped newest-first list.
 *   KEYS: 1 guard, 2 source counter, 3 list
 *   ARGV: 1 guard TTL, 2 source TTL, 3 source cap (0 = no source), 4 flag JSON, 5 last list index
 */
export const LOG_FLAG_LUA = `
if not redis.call('SET', KEYS[1], '1', 'NX', 'EX', ARGV[1]) then return 0 end
local cap = tonumber(ARGV[3])
if cap > 0 then
  local n = redis.call('INCR', KEYS[2])
  if n == 1 then redis.call('EXPIRE', KEYS[2], ARGV[2]) end
  if n > cap then return 0 end
end
redis.call('LPUSH', KEYS[3], ARGV[4])
redis.call('LTRIM', KEYS[3], 0, tonumber(ARGV[5]))
return 1`;

/** Placeholder source key segment when the client IP is unknown (the cap is then off). */
const NO_SOURCE = "-";

const TIMEOUT_MS = 3000;

export interface UpstashConfig {
  url: string;
  token: string;
}

export function upstashConfigFromEnv(env: NodeJS.ProcessEnv = process.env): UpstashConfig | null {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

type Command = (string | number)[];
type Reply = { result?: unknown; error?: string };

function toInt(x: unknown): number {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : 0;
  return Number.isFinite(n) ? n : 0;
}

/** HGETALL over REST is a flat [field, value, field, value, …] array. */
function flatToMap(x: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (Array.isArray(x)) {
    for (let i = 0; i + 1 < x.length; i += 2) out.set(String(x[i]), toInt(x[i + 1]));
  } else if (x && typeof x === "object") {
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) out.set(k, toInt(v));
  }
  return out;
}

function numericKeys(m: Map<string, number>): Map<number, number> {
  const out = new Map<number, number>();
  for (const [k, v] of m) {
    const n = Number(k);
    if (Number.isFinite(n)) out.set(n, v);
  }
  return out;
}

export class UpstashStore implements Store {
  readonly kind = "upstash" as const;
  private readonly keys: StoreKeys;

  /** `ns` is the key namespace (statsNamespace(kind)); getStore() always passes it. */
  constructor(
    private readonly config: UpstashConfig,
    readonly ns: string,
  ) {
    this.keys = keysFor(ns);
  }

  /** One HTTP request for any number of commands. Throws on transport or command errors. */
  async pipeline(commands: Command[]): Promise<unknown[]> {
    const res = await fetch(`${this.config.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands.map((c) => c.map(String))),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body) || body.length !== commands.length) throw new Error("Upstash: malformed pipeline reply");
    return body.map((r: Reply, i) => {
      if (r && typeof r === "object" && typeof r.error === "string") {
        throw new Error(`Upstash: ${String(commands[i]?.[0])} failed: ${r.error}`);
      }
      return r?.result ?? null;
    });
  }

  /** SET NX then GET in one request: the value that stands (ours on the first call). */
  private async claim(key: string, value: string, ttlSeconds: number): Promise<string | null> {
    const [, got] = await this.pipeline([
      ["SET", key, value, "NX", "EX", ttlSeconds],
      ["GET", key],
    ]);
    return typeof got === "string" ? got : null;
  }

  async claimRoundStart(date: string, playerId: string, i: number, startMs: number): Promise<number> {
    const got = Number(await this.claim(this.keys.start(date, playerId, i), String(startMs), ROUND_STATE_TTL_SECONDS));
    return Number.isSafeInteger(got) && got > 0 ? got : startMs;
  }

  async claimAccepted(date: string, playerId: string, i: number, value: string): Promise<string> {
    return (await this.claim(this.keys.accept(date, playerId, i), value, ROUND_STATE_TTL_SECONDS)) ?? value;
  }

  async recordFinish(date: string, playerId: string, rec: FinishRecord, source?: string | null): Promise<FinishOutcome> {
    const ks = [
      this.keys.player(date, playerId),
      this.keys.source(date, source || NO_SOURCE),
      this.keys.plays(date),
      this.keys.distSum(date),
      this.keys.dist(date),
      ...rec.answers.map((_, i) => this.keys.round(date, i)),
    ];
    const args = [
      FIRST_FINISH_TTL_SECONDS,
      SOURCE_TTL_SECONDS,
      source ? FINISHES_PER_SOURCE : 0,
      rec.distance,
      ...rec.answers.map((id) => id ?? MISS_FIELD),
    ];
    const [r] = await this.pipeline([["EVAL", RECORD_FINISH_LUA, ks.length, ...ks, ...args]]);
    const code = toInt(r);
    return { first: code === 1 || code === 2, counted: code === 1 };
  }

  async getPlays(date: string): Promise<number> {
    const [r] = await this.pipeline([["GET", this.keys.plays(date)]]);
    return toInt(r);
  }

  async getDistanceSum(date: string): Promise<number> {
    const [r] = await this.pipeline([["GET", this.keys.distSum(date)]]);
    return toInt(r);
  }

  async getDistanceHist(date: string): Promise<Map<number, number>> {
    const [r] = await this.pipeline([["HGETALL", this.keys.dist(date)]]);
    return numericKeys(flatToMap(r));
  }

  async getRoundCounts(date: string, i: number): Promise<Map<string, number>> {
    const [r] = await this.pipeline([["HGETALL", this.keys.round(date, i)]]);
    return flatToMap(r);
  }

  async getStats(date: string, rounds: number): Promise<DateStats> {
    const n = Math.max(0, rounds);
    const replies = await this.pipeline([
      ["GET", this.keys.plays(date)],
      ["GET", this.keys.distSum(date)],
      ["HGETALL", this.keys.dist(date)],
      ...Array.from({ length: n }, (_, i): Command => ["HGETALL", this.keys.round(date, i)]),
    ]);
    return {
      plays: toInt(replies[0]),
      distSum: toInt(replies[1]),
      hist: numericKeys(flatToMap(replies[2])),
      rounds: Array.from({ length: n }, (_, i) => flatToMap(replies[3 + i])),
    };
  }

  async logRejected(date: string, i: number, key: string): Promise<void> {
    await this.pipeline([["EVAL", LOG_REJECTED_LUA, 1, this.keys.rejected(date, i), key, REJECTED_FIELDS_CAP, REJECTED_TTL_SECONDS]]);
  }

  async logFlag(date: string, flag: FlagRecord, source?: string | null): Promise<void> {
    const ks = [this.keys.flagGuard(date, flag.p, flag.i), this.keys.flagSource(date, source || NO_SOURCE), this.keys.flags(date)];
    const args = [FIRST_FINISH_TTL_SECONDS, SOURCE_TTL_SECONDS, source ? FLAGS_PER_SOURCE : 0, JSON.stringify(flag), FLAGS_CAP - 1];
    await this.pipeline([["EVAL", LOG_FLAG_LUA, ks.length, ...ks, ...args]]);
  }
}
