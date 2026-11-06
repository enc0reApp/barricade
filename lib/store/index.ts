/**
 * getStore(kind): Upstash when configured, else the in-memory store, with
 * every key namespaced by deployment env + pack kind (statsNamespace).
 * Gameplay calls use neutral values on failure. Answer reports propagate
 * failures so the player never receives a false delivery confirmation.
 */

import { MemoryStore } from "./memory";
import { emptyStats, statsNamespace, type PackKind, type Store } from "./types";
import { UpstashStore, upstashConfigFromEnv } from "./upstash";

export type { DateStats, FinishOutcome, FinishRecord, FlagRecord, PackKind, Store, StoreKeys } from "./types";
export {
  FINISHES_PER_SOURCE,
  FLAGS_PER_SOURCE,
  MISS_FIELD,
  REJECTED_FIELDS_CAP,
  keysFor,
  statsEnv,
  statsNamespace,
} from "./types";
export { MemoryStore } from "./memory";
export { UpstashStore, upstashConfigFromEnv } from "./upstash";

const cached = new Map<string, Store>();

/** Production without Redis: accept writes, remember nothing, report an empty crowd. */
class NullStore implements Store {
  readonly kind = "none" as const;
  constructor(readonly ns: string) {}
  async claimRoundStart(_date: string, _playerId: string, _i: number, startMs: number) {
    return startMs;
  }
  async claimAccepted(_date: string, _playerId: string, _i: number, value: string) {
    return value;
  }
  async recordFinish() {
    return { first: true, counted: false };
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

/** Gameplay survives store outages; explicit report submissions must confirm delivery. */
export function safeStore(inner: Store): Store {
  return {
    kind: inner.kind,
    ns: inner.ns,
    // A store outage must not block play: the proposed start / our own answer stands.
    claimRoundStart: (date, playerId, i, startMs) =>
      guarded("claimRoundStart", startMs, () => inner.claimRoundStart(date, playerId, i, startMs)),
    claimAccepted: (date, playerId, i, value) =>
      guarded("claimAccepted", value, () => inner.claimAccepted(date, playerId, i, value)),
    recordFinish: (date, playerId, rec, source) =>
      guarded("recordFinish", { first: false, counted: false }, () => inner.recordFinish(date, playerId, rec, source)),
    getPlays: (date) => guarded("getPlays", 0, () => inner.getPlays(date)),
    getDistanceSum: (date) => guarded("getDistanceSum", 0, () => inner.getDistanceSum(date)),
    getDistanceHist: (date) => guarded("getDistanceHist", new Map<number, number>(), () => inner.getDistanceHist(date)),
    getRoundCounts: (date, i) => guarded("getRoundCounts", new Map<string, number>(), () => inner.getRoundCounts(date, i)),
    getStats: (date, rounds) => guarded("getStats", { ...emptyStats(rounds), available: false }, () => inner.getStats(date, rounds)),
    logRejected: (date, i, key) => guarded("logRejected", undefined, () => inner.logRejected(date, i, key)),
    logFlag: (date, flag, source) => inner.logFlag(date, flag, source),
  };
}

/** The store for one pack kind ("sample" plays never share keys with "production" ones). */
export function getStore(kind: PackKind): Store {
  const config = upstashConfigFromEnv();
  const ns = statsNamespace(kind);
  const prodWithoutRedis = !config && process.env.NODE_ENV === "production" && process.env.BARRICADE_MEMORY_STORE !== "1";
  const backend = config ? `upstash:${config.url}` : prodWithoutRedis ? "none" : "memory";
  const sig = `${backend}|${ns}`;
  const hit = cached.get(sig);
  if (hit) return hit;
  if (!config && process.env.NODE_ENV === "production" && !warnedMemoryInProd) {
    warnedMemoryInProd = true;
    console.warn("[barricade] No Upstash Redis configured — crowd stats are disabled (set KV_REST_API_URL/KV_REST_API_TOKEN).");
  }
  const store = safeStore(config ? new UpstashStore(config, ns) : prodWithoutRedis ? new NullStore(ns) : new MemoryStore(ns));
  if (cached.size > 16) cached.clear();
  cached.set(sig, store);
  return store;
}

/** Tests: forget the cached stores (memory data lives on globalThis; clear it via MemoryStore#clear()). */
export function resetStoreCache(): void {
  cached.clear();
}
