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
  FIRST_FINISH_TTL_SECONDS,
  FLAGS_CAP,
  MISS_FIELD,
  keys,
  type DateStats,
  type FinishRecord,
  type FlagRecord,
  type Store,
} from "./types";

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

  constructor(private readonly config: UpstashConfig) {}

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

  async recordFinish(date: string, playerId: string, rec: FinishRecord): Promise<{ first: boolean }> {
    const [guard] = await this.pipeline([
      ["SET", keys.player(date, playerId), "1", "NX", "EX", FIRST_FINISH_TTL_SECONDS],
    ]);
    if (guard !== "OK") return { first: false };
    const writes: Command[] = [
      ["INCR", keys.plays(date)],
      ["INCRBY", keys.distSum(date), rec.distance],
      ["HINCRBY", keys.dist(date), rec.distance, 1],
      ...rec.answers.map((id, i): Command => ["HINCRBY", keys.round(date, i), id ?? MISS_FIELD, 1]),
    ];
    await this.pipeline(writes);
    return { first: true };
  }

  async getPlays(date: string): Promise<number> {
    const [r] = await this.pipeline([["GET", keys.plays(date)]]);
    return toInt(r);
  }

  async getDistanceSum(date: string): Promise<number> {
    const [r] = await this.pipeline([["GET", keys.distSum(date)]]);
    return toInt(r);
  }

  async getDistanceHist(date: string): Promise<Map<number, number>> {
    const [r] = await this.pipeline([["HGETALL", keys.dist(date)]]);
    return numericKeys(flatToMap(r));
  }

  async getRoundCounts(date: string, i: number): Promise<Map<string, number>> {
    const [r] = await this.pipeline([["HGETALL", keys.round(date, i)]]);
    return flatToMap(r);
  }

  async getStats(date: string, rounds: number): Promise<DateStats> {
    const n = Math.max(0, rounds);
    const replies = await this.pipeline([
      ["GET", keys.plays(date)],
      ["GET", keys.distSum(date)],
      ["HGETALL", keys.dist(date)],
      ...Array.from({ length: n }, (_, i): Command => ["HGETALL", keys.round(date, i)]),
    ]);
    return {
      plays: toInt(replies[0]),
      distSum: toInt(replies[1]),
      hist: numericKeys(flatToMap(replies[2])),
      rounds: Array.from({ length: n }, (_, i) => flatToMap(replies[3 + i])),
    };
  }

  async logRejected(date: string, i: number, key: string): Promise<void> {
    await this.pipeline([["HINCRBY", keys.rejected(date, i), key, 1]]);
  }

  async logFlag(date: string, flag: FlagRecord): Promise<void> {
    const k = keys.flags(date);
    await this.pipeline([
      ["LPUSH", k, JSON.stringify(flag)],
      ["LTRIM", k, 0, FLAGS_CAP - 1],
    ]);
  }
}
