/**
 * getStore(): Upstash when configured, else the in-memory store.
 * Every call goes through a safety wrapper — a store failure is logged and
 * answered with a neutral value; it never breaks gameplay.
 */

import { MemoryStore } from "./memory";
import { emptyStats, type Store } from "./types";
import { UpstashStore, upstashConfigFromEnv } from "./upstash";

export type { DateStats, FinishRecord, FlagRecord, Store } from "./types";
export { MISS_FIELD, keys } from "./types";
export { MemoryStore } from "./memory";
export { UpstashStore, upstashConfigFromEnv } from "./upstash";

let cached: { sig: string; store: Store } | null = null;

/** Production without Redis: accept writes, remember nothing, report an empty crowd. */
class NullStore implements Store {
  readonly kind = "none" as const;
  async recordFinish() {
    return { first: true };
  }
  async getPlays() {
    return 0;
  }
  async getDistanceSum() {
    return 0;
  }
  async getDistanceHist() {
    return new Map<number, number>();
  }
  async getRoundCounts() {
    return new Map<string, number>();
  }
  async getStats(_date: string, rounds: number) {
    return emptyStats(rounds);
  }
  async logRejected() {}
  async logFlag() {}
}
let warnedMemoryInProd = false;

async function guarded<T>(what: string, neutral: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    console.error(`[barricade] store.${what} failed:`, err instanceof Error ? err.message : err);
    return neutral;
  }
}

/** Wraps a store so every method catches, logs and returns a neutral value. */
export function safeStore(inner: Store): Store {
  return {
    kind: inner.kind,
    recordFinish: (date, playerId, rec) =>
      guarded("recordFinish", { first: false }, () => inner.recordFinish(date, playerId, rec)),
    getPlays: (date) => guarded("getPlays", 0, () => inner.getPlays(date)),
    getDistanceSum: (date) => guarded("getDistanceSum", 0, () => inner.getDistanceSum(date)),
    getDistanceHist: (date) => guarded("getDistanceHist", new Map<number, number>(), () => inner.getDistanceHist(date)),
    getRoundCounts: (date, i) => guarded("getRoundCounts", new Map<string, number>(), () => inner.getRoundCounts(date, i)),
    getStats: (date, rounds) => guarded("getStats", emptyStats(rounds), () => inner.getStats(date, rounds)),
    logRejected: (date, i, key) => guarded("logRejected", undefined, () => inner.logRejected(date, i, key)),
    logFlag: (date, flag) => guarded("logFlag", undefined, () => inner.logFlag(date, flag)),
  };
}

export function getStore(): Store {
  const config = upstashConfigFromEnv();
  const prodWithoutRedis = !config && process.env.NODE_ENV === "production" && process.env.BARRICADE_MEMORY_STORE !== "1";
  const sig = config ? `upstash:${config.url}` : prodWithoutRedis ? "none" : "memory";
  if (cached && cached.sig === sig) return cached.store;
  if (!config && process.env.NODE_ENV === "production" && !warnedMemoryInProd) {
    warnedMemoryInProd = true;
    console.warn("[barricade] No Upstash Redis configured — crowd stats are disabled (set KV_REST_API_URL/KV_REST_API_TOKEN).");
  }
  const store = safeStore(config ? new UpstashStore(config) : prodWithoutRedis ? new NullStore() : new MemoryStore());
  cached = { sig, store };
  return store;
}

/** Tests: forget the cached store (memory data lives on globalThis; clear it via new MemoryStore().clear()). */
export function resetStoreCache(): void {
  cached = null;
}
