import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getStore,
  MemoryStore,
  resetStoreCache,
  safeStore,
  type Store,
  UpstashStore,
  upstashConfigFromEnv,
} from "../../lib/store";

const DATE = "2026-11-10";

beforeEach(() => {
  for (const k of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) {
    vi.stubEnv(k, "");
  }
  resetStoreCache();
  new MemoryStore().clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetStoreCache();
});

describe("MemoryStore", () => {
  it("counts each player once per date", async () => {
    const s = new MemoryStore();
    expect(await s.recordFinish(DATE, "player0001", { distance: 315, answers: ["a:x", null] })).toEqual({ first: true });
    expect(await s.recordFinish(DATE, "player0001", { distance: 0, answers: ["a:y", "a:y"] })).toEqual({ first: false });
    expect(await s.recordFinish(DATE, "player0002", { distance: 315, answers: ["a:x", "a:z"] })).toEqual({ first: true });
    expect(await s.recordFinish("2026-11-11", "player0001", { distance: 700, answers: [null, null] })).toEqual({ first: true });
    const stats = await s.getStats(DATE, 2);
    expect(stats.plays).toBe(2);
    expect(stats.distSum).toBe(630);
    expect(Object.fromEntries(stats.hist)).toEqual({ 315: 2 });
    expect(Object.fromEntries(stats.rounds[0]!)).toEqual({ "a:x": 2 });
    expect(Object.fromEntries(stats.rounds[1]!)).toEqual({ miss: 1, "a:z": 1 });
    expect(await s.getPlays(DATE)).toBe(2);
    expect(await s.getDistanceSum(DATE)).toBe(630);
  });

  it("keeps data across instances (globalThis) and caps flags", async () => {
    const a = new MemoryStore();
    await a.logRejected(DATE, 3, "nope");
    await a.logRejected(DATE, 3, "nope");
    expect(Object.fromEntries(new MemoryStore().rejected(DATE, 3))).toEqual({ nope: 2 });
    for (let i = 0; i < 1005; i++) await a.logFlag(DATE, { i: 0, text: `t${i}`, p: "player0001", at: i });
    const flags = new MemoryStore().flags(DATE);
    expect(flags).toHaveLength(1000);
    expect(flags[0]!.text).toBe("t1004");
  });
});

describe("safeStore", () => {
  it("logs and returns neutral values when the backend throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = () => Promise.reject(new Error("down"));
    const broken: Store = {
      kind: "upstash",
      recordFinish: boom,
      getPlays: boom,
      getDistanceSum: boom,
      getDistanceHist: boom,
      getRoundCounts: boom,
      getStats: boom,
      logRejected: boom,
      logFlag: boom,
    };
    const s = safeStore(broken);
    expect(await s.recordFinish(DATE, "player0001", { distance: 1, answers: [] })).toEqual({ first: false });
    expect(await s.getPlays(DATE)).toBe(0);
    expect(await s.getDistanceSum(DATE)).toBe(0);
    expect((await s.getDistanceHist(DATE)).size).toBe(0);
    expect((await s.getRoundCounts(DATE, 0)).size).toBe(0);
    const stats = await s.getStats(DATE, 7);
    expect(stats).toMatchObject({ plays: 0, distSum: 0 });
    expect(stats.rounds).toHaveLength(7);
    await expect(s.logRejected(DATE, 0, "k")).resolves.toBeUndefined();
    await expect(s.logFlag(DATE, { i: 0, text: "t", p: "player0001", at: 0 })).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledTimes(8);
  });
});

describe("UpstashStore (REST pipeline)", () => {
  type Sent = { url: string; auth: string | null; body: unknown };

  function fakeRedis(reply: (cmds: string[][]) => unknown[]) {
    const sent: Sent[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as string[][];
        sent.push({ url, auth: new Headers(init.headers).get("authorization"), body });
        return new Response(JSON.stringify(reply(body)));
      }),
    );
    return sent;
  }

  const store = () => new UpstashStore({ url: "https://redis.example", token: "tok" });

  it("guards with SET NX EX, then writes everything in ONE pipeline", async () => {
    const sent = fakeRedis((cmds) => cmds.map((c) => ({ result: c[0] === "SET" ? "OK" : 1 })));
    expect(await store().recordFinish(DATE, "player0001", { distance: 315, answers: ["artist:x", null] })).toEqual({ first: true });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({
      url: "https://redis.example/pipeline",
      auth: "Bearer tok",
      body: [["SET", `b:${DATE}:p:player0001`, "1", "NX", "EX", "259200"]],
    });
    expect(sent[1]!.body).toEqual([
      ["INCR", `b:${DATE}:plays`],
      ["INCRBY", `b:${DATE}:distsum`, "315"],
      ["HINCRBY", `b:${DATE}:dist`, "315", "1"],
      ["HINCRBY", `b:${DATE}:r0`, "artist:x", "1"],
      ["HINCRBY", `b:${DATE}:r1`, "miss", "1"],
    ]);
  });

  it("does not write when the guard already exists", async () => {
    const sent = fakeRedis(() => [{ result: null }]);
    expect(await store().recordFinish(DATE, "player0001", { distance: 1, answers: [] })).toEqual({ first: false });
    expect(sent).toHaveLength(1);
  });

  it("reads stats in one pipeline and parses flat HGETALL replies", async () => {
    const sent = fakeRedis(() => [
      { result: "3" },
      { result: "1000" },
      { result: ["315", "2", "370", "1"] },
      { result: ["artist:x", "2", "miss", "1"] },
      { result: [] },
    ]);
    const stats = await store().getStats(DATE, 2);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual([
      ["GET", `b:${DATE}:plays`],
      ["GET", `b:${DATE}:distsum`],
      ["HGETALL", `b:${DATE}:dist`],
      ["HGETALL", `b:${DATE}:r0`],
      ["HGETALL", `b:${DATE}:r1`],
    ]);
    expect(stats.plays).toBe(3);
    expect(stats.distSum).toBe(1000);
    expect(Object.fromEntries(stats.hist)).toEqual({ 315: 2, 370: 1 });
    expect(Object.fromEntries(stats.rounds[0]!)).toEqual({ "artist:x": 2, miss: 1 });
    expect(stats.rounds[1]!.size).toBe(0);
  });

  it("logs rejected keys and capped flags", async () => {
    const sent = fakeRedis((cmds) => cmds.map(() => ({ result: 1 })));
    await store().logRejected(DATE, 2, "berghian");
    await store().logFlag(DATE, { i: 2, text: "Mike Banks", p: "player0001", at: 5 });
    expect(sent[0]!.body).toEqual([["HINCRBY", `b:${DATE}:rej2`, "berghian", "1"]]);
    expect(sent[1]!.body).toEqual([
      ["LPUSH", `b:${DATE}:flags`, JSON.stringify({ i: 2, text: "Mike Banks", p: "player0001", at: 5 })],
      ["LTRIM", `b:${DATE}:flags`, "0", "999"],
    ]);
  });

  it("throws on command errors and HTTP errors (safeStore neutralises them)", async () => {
    fakeRedis(() => [{ error: "WRONGTYPE" }]);
    await expect(store().getPlays(DATE)).rejects.toThrow(/WRONGTYPE/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    await expect(store().getPlays(DATE)).rejects.toThrow(/401/);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await safeStore(store()).getPlays(DATE)).toBe(0);
  });
});

describe("getStore", () => {
  it("uses memory without config and Upstash with either env naming", () => {
    expect(getStore().kind).toBe("memory");
    vi.stubEnv("KV_REST_API_URL", "https://kv.example/");
    vi.stubEnv("KV_REST_API_TOKEN", "t1");
    expect(upstashConfigFromEnv()).toEqual({ url: "https://kv.example", token: "t1" });
    expect(getStore().kind).toBe("upstash");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://up.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t2");
    expect(upstashConfigFromEnv()).toEqual({ url: "https://up.example", token: "t2" });
    expect(getStore().kind).toBe("upstash");
  });
});
