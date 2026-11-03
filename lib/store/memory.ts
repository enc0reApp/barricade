/**
 * In-memory store (dev + tests). Lives on globalThis so Next dev HMR keeps
 * the data across module reloads. Not shared between serverless instances.
 * Mirrors the Upstash semantics (NX guards, per-IP caps, field caps); TTLs
 * apply to the NX strings only.
 */

import {
  FINISHES_PER_SOURCE,
  FIRST_FINISH_TTL_SECONDS,
  FLAGS_CAP,
  FLAGS_PER_SOURCE,
  keysFor,
  MISS_FIELD,
  REJECTED_FIELDS_CAP,
  ROUND_STATE_TTL_SECONDS,
  type DateStats,
  type FinishOutcome,
  type FinishRecord,
  type FlagRecord,
  type Store,
  type StoreKeys,
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

function incr(key: string, by: number): number {
  const d = data();
  const n = (d.counters.get(key) ?? 0) + by;
  d.counters.set(key, n);
  return n;
}

/** SET key value NX EX ttl, then GET: the value that stands. */
function setNx(key: string, value: string, ttlSeconds: number): { set: boolean; value: string } {
  const d = data();
  const now = Date.now();
  const existing = d.strings.get(key);
  if (existing && existing.expiresAt > now) return { set: false, value: existing.value };
  d.strings.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
  return { set: true, value };
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
  private readonly keys: StoreKeys;

  /** `ns` is the key namespace (statsNamespace(kind)); getStore() always passes it. */
  constructor(readonly ns: string) {
    this.keys = keysFor(ns);
  }

  async claimRoundStart(date: string, playerId: string, i: number, startMs: number): Promise<number> {
    const { value } = setNx(this.keys.start(date, playerId, i), String(startMs), ROUND_STATE_TTL_SECONDS);
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : startMs;
  }

  async claimAccepted(date: string, playerId: string, i: number, value: string): Promise<string> {
    return setNx(this.keys.accept(date, playerId, i), value, ROUND_STATE_TTL_SECONDS).value;
  }

  async recordFinish(date: string, playerId: string, rec: FinishRecord, source?: string | null): Promise<FinishOutcome> {
    if (!setNx(this.keys.player(date, playerId), "1", FIRST_FINISH_TTL_SECONDS).set) return { first: false, counted: false };
    if (source && incr(this.keys.source(date, source), 1) > FINISHES_PER_SOURCE) return { first: true, counted: false };
    incr(this.keys.plays(date), 1);
    incr(this.keys.distSum(date), rec.distance);
    hincr(this.keys.dist(date), String(rec.distance), 1);
    rec.answers.forEach((id, i) => hincr(this.keys.round(date, i), id ?? MISS_FIELD, 1));
    return { first: true, counted: true };
  }

  async getPlays(date: string): Promise<number> {
    return data().counters.get(this.keys.plays(date)) ?? 0;
  }

  async getDistanceSum(date: string): Promise<number> {
    return data().counters.get(this.keys.distSum(date)) ?? 0;
  }

  async getDistanceHist(date: string): Promise<Map<number, number>> {
    return numericHash(this.keys.dist(date));
  }

  async getRoundCounts(date: string, i: number): Promise<Map<string, number>> {
    return hash(this.keys.round(date, i));
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
    const k = this.keys.rejected(date, i);
    const h = data().hashes.get(k);
    if (h && !h.has(key) && h.size >= REJECTED_FIELDS_CAP) return;
    hincr(k, key, 1);
  }

  async logFlag(date: string, flag: FlagRecord, source?: string | null): Promise<void> {
    if (!setNx(this.keys.flagGuard(date, flag.p, flag.i), "1", FIRST_FINISH_TTL_SECONDS).set) return;
    if (source && incr(this.keys.flagSource(date, source), 1) > FLAGS_PER_SOURCE) return;
    const d = data();
    const k = this.keys.flags(date);
    const list = d.lists.get(k) ?? [];
    list.unshift(JSON.stringify(flag));
    if (list.length > FLAGS_CAP) list.length = FLAGS_CAP;
    d.lists.set(k, list);
  }

  /* ── test/dev helpers (not part of Store) ── */

  /** Wipe everything (every namespace). */
  clear(): void {
    const d = data();
    d.strings.clear();
    d.counters.clear();
    d.hashes.clear();
    d.lists.clear();
  }

  rejected(date: string, i: number): Map<string, number> {
    return hash(this.keys.rejected(date, i));
  }

  flags(date: string): FlagRecord[] {
    return (data().lists.get(this.keys.flags(date)) ?? []).map((s) => JSON.parse(s) as FlagRecord);
  }

  /** Every key currently held (any namespace) — tests check the layout. */
  allKeys(): string[] {
    const d = data();
    return [...d.strings.keys(), ...d.counters.keys(), ...d.hashes.keys(), ...d.lists.keys()].sort();
  }
}
