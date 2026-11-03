/**
 * In-memory store (dev + tests). Lives on globalThis so Next dev HMR keeps
 * the data across module reloads. Not shared between serverless instances.
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

interface MemoryData {
  strings: Map<string, { value: string; expiresAt: number }>;
  counters: Map<string, number>;
  hashes: Map<string, Map<string, number>>;
  lists: Map<string, string[]>;
}

const GLOBAL_KEY = "__barricadeMemoryStore";

function data(): MemoryData {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: MemoryData };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { strings: new Map(), counters: new Map(), hashes: new Map(), lists: new Map() };
  }
  return g[GLOBAL_KEY];
}

function hincr(key: string, field: string, by: number): void {
  const d = data();
  let h = d.hashes.get(key);
  if (!h) {
    h = new Map();
    d.hashes.set(key, h);
  }
  h.set(field, (h.get(field) ?? 0) + by);
}

function incr(key: string, by: number): void {
  const d = data();
  d.counters.set(key, (d.counters.get(key) ?? 0) + by);
}

function hash(key: string): Map<string, number> {
  return new Map(data().hashes.get(key) ?? []);
}

function numericHash(key: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const [k, v] of data().hashes.get(key) ?? []) {
    const n = Number(k);
    if (Number.isFinite(n)) out.set(n, v);
  }
  return out;
}

export class MemoryStore implements Store {
  readonly kind = "memory" as const;

  async recordFinish(date: string, playerId: string, rec: FinishRecord): Promise<{ first: boolean }> {
    const d = data();
    const guard = keys.player(date, playerId);
    const now = Date.now();
    const existing = d.strings.get(guard);
    if (existing && existing.expiresAt > now) return { first: false };
    d.strings.set(guard, { value: "1", expiresAt: now + FIRST_FINISH_TTL_SECONDS * 1000 });
    incr(keys.plays(date), 1);
    incr(keys.distSum(date), rec.distance);
    hincr(keys.dist(date), String(rec.distance), 1);
    rec.answers.forEach((id, i) => hincr(keys.round(date, i), id ?? MISS_FIELD, 1));
    return { first: true };
  }

  async getPlays(date: string): Promise<number> {
    return data().counters.get(keys.plays(date)) ?? 0;
  }

  async getDistanceSum(date: string): Promise<number> {
    return data().counters.get(keys.distSum(date)) ?? 0;
  }

  async getDistanceHist(date: string): Promise<Map<number, number>> {
    return numericHash(keys.dist(date));
  }

  async getRoundCounts(date: string, i: number): Promise<Map<string, number>> {
    return hash(keys.round(date, i));
  }

  async getStats(date: string, rounds: number): Promise<DateStats> {
    return {
      plays: await this.getPlays(date),
      distSum: await this.getDistanceSum(date),
      hist: await this.getDistanceHist(date),
      rounds: await Promise.all(Array.from({ length: rounds }, (_, i) => this.getRoundCounts(date, i))),
    };
  }

  async logRejected(date: string, i: number, key: string): Promise<void> {
    hincr(keys.rejected(date, i), key, 1);
  }

  async logFlag(date: string, flag: FlagRecord): Promise<void> {
    const d = data();
    const k = keys.flags(date);
    const list = d.lists.get(k) ?? [];
    list.unshift(JSON.stringify(flag));
    if (list.length > FLAGS_CAP) list.length = FLAGS_CAP;
    d.lists.set(k, list);
  }

  /* ── test/dev helpers (not part of Store) ── */

  /** Wipe everything. */
  clear(): void {
    const d = data();
    d.strings.clear();
    d.counters.clear();
    d.hashes.clear();
    d.lists.clear();
  }

  rejected(date: string, i: number): Map<string, number> {
    return hash(keys.rejected(date, i));
  }

  flags(date: string): FlagRecord[] {
    return (data().lists.get(keys.flags(date)) ?? []).map((s) => JSON.parse(s) as FlagRecord);
  }
}
