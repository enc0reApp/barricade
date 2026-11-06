import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FINISHES_PER_SOURCE,
  getStore,
  MemoryStore,
  REJECTED_FIELDS_CAP,
  resetStoreCache,
  safeStore,
  statsEnv,
  statsNamespace,
  type Store,
  UpstashStore,
  upstashConfigFromEnv,
} from "../../lib/store";
import { LOG_FLAG_LUA, LOG_REJECTED_LUA, RECORD_FINISH_LUA } from "../../lib/store/upstash";

const DATE = "2026-11-10";
const NS = "b:test:production";

beforeEach(() => {
  for (const k of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "VERCEL_ENV"]) {
    vi.stubEnv(k, "");
  }
  resetStoreCache();
  new MemoryStore(NS).clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetStoreCache();
});

describe("MemoryStore", () => {
  it("counts each player once per date", async () => {
    const s = new MemoryStore(NS);
    const yes = { first: true, counted: true };
    expect(await s.recordFinish(DATE, "player0001", { distance: 315, answers: ["a:x", null] })).toEqual(yes);
    expect(await s.recordFinish(DATE, "player0001", { distance: 0, answers: ["a:y", "a:y"] })).toEqual({ first: false, counted: false });
    expect(await s.recordFinish(DATE, "player0002", { distance: 315, answers: ["a:x", "a:z"] })).toEqual(yes);
    expect(await s.recordFinish("2026-11-11", "player0001", { distance: 700, answers: [null, null] })).toEqual(yes);
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
    const a = new MemoryStore(NS);
    await a.logRejected(DATE, 3, "nope");
    await a.logRejected(DATE, 3, "nope");
    expect(Object.fromEntries(new MemoryStore(NS).rejected(DATE, 3))).toEqual({ nope: 2 });
    // One flag per player per round: 1005 distinct players, no source cap (unknown IP).
    for (let i = 0; i < 1005; i++) await a.logFlag(DATE, { i: 0, text: `t${i}`, p: `player${String(i).padStart(4, "0")}`, at: i });
    const flags = new MemoryStore(NS).flags(DATE);
    expect(flags).toHaveLength(1000);
    expect(flags[0]!.text).toBe("t1004");
  });

  it("namespaces never see each other's data", async () => {
    const prod = new MemoryStore(NS);
    const sample = new MemoryStore("b:test:sample");
    const preview = new MemoryStore("b:preview:production");
    await sample.recordFinish(DATE, "player0001", { distance: 10, answers: ["a:x"] });
    await preview.recordFinish(DATE, "player0001", { distance: 10, answers: ["a:x"] });
    expect((await prod.getStats(DATE, 1)).plays).toBe(0);
    expect(await prod.recordFinish(DATE, "player0001", { distance: 10, answers: ["a:x"] })).toEqual({ first: true, counted: true });
    expect((await sample.getStats(DATE, 1)).plays).toBe(1);
  });

  it("claims the first round start and the first accepted answer (NX)", async () => {
    const s = new MemoryStore(NS);
    expect(await s.claimRoundStart(DATE, "player0001", 0, 1000)).toBe(1000);
    expect(await s.claimRoundStart(DATE, "player0001", 0, 5000)).toBe(1000);
    expect(await s.claimRoundStart(DATE, "player0001", 1, 5000)).toBe(5000);
    expect(await s.claimRoundStart(DATE, "player0002", 0, 7000)).toBe(7000);
    expect(await s.claimAccepted(DATE, "player0001", 0, "first")).toBe("first");
    expect(await s.claimAccepted(DATE, "player0001", 0, "second")).toBe("first");
  });

  it("caps counted finishes per source; repeat finishes never touch the source counter", async () => {
    const s = new MemoryStore(NS);
    for (let n = 0; n < FINISHES_PER_SOURCE; n++) {
      expect(await s.recordFinish(DATE, `player${String(n).padStart(4, "0")}`, { distance: 1, answers: [] }, "src1")).toEqual({
        first: true,
        counted: true,
      });
      // A repeat doesn't use up the cap.
      await s.recordFinish(DATE, `player${String(n).padStart(4, "0")}`, { distance: 1, answers: [] }, "src1");
    }
    expect(await s.recordFinish(DATE, "player9999", { distance: 1, answers: [] }, "src1")).toEqual({ first: true, counted: false });
    expect(await s.recordFinish(DATE, "player9998", { distance: 1, answers: [] }, "src2")).toEqual({ first: true, counted: true });
    expect(await s.recordFinish(DATE, "player9997", { distance: 1, answers: [] }, null)).toEqual({ first: true, counted: true });
    expect(await s.getPlays(DATE)).toBe(FINISHES_PER_SOURCE + 2);
  });

  it("caps rejected-try fields per round; keys already logged keep counting", async () => {
    const s = new MemoryStore(NS);
    for (let n = 0; n < REJECTED_FIELDS_CAP + 10; n++) await s.logRejected(DATE, 0, `junk${n}`);
    await s.logRejected(DATE, 0, "junk0");
    const h = s.rejected(DATE, 0);
    expect(h.size).toBe(REJECTED_FIELDS_CAP);
    expect(h.get("junk0")).toBe(2);
    expect(h.has(`junk${REJECTED_FIELDS_CAP}`)).toBe(false);
  });

  it("logs one flag per player per round", async () => {
    const s = new MemoryStore(NS);
    await s.logFlag(DATE, { i: 0, text: "a", p: "player0001", at: 1 });
    await s.logFlag(DATE, { i: 0, text: "b", p: "player0001", at: 2 });
    await s.logFlag(DATE, { i: 1, text: "c", p: "player0001", at: 3 });
    expect(s.flags(DATE).map((f) => f.text)).toEqual(["c", "a"]);
  });
});

describe("statsNamespace", () => {
  it("is b:{VERCEL_ENV || NODE_ENV}:{kind}", () => {
    expect(statsNamespace("production", { VERCEL_ENV: "production", NODE_ENV: "production" })).toBe("b:production:production");
    expect(statsNamespace("production", { VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe("b:preview:production");
    expect(statsNamespace("sample", { VERCEL_ENV: "production", NODE_ENV: "production" })).toBe("b:production:sample");
    expect(statsNamespace("production", { NODE_ENV: "development" })).toBe("b:development:production");
    expect(statsNamespace("production", {})).toBe("b:development:production");
    expect(statsEnv({ VERCEL_ENV: "we:ird env" })).toBe("other");
  });
});

describe("safeStore", () => {
  it("logs and returns neutral values when the backend throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = () => Promise.reject(new Error("down"));
    const broken: Store = {
      kind: "upstash",
      ns: NS,
      claimRoundStart: boom,
      claimAccepted: boom,
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
    // A store outage never blocks play: the proposed start / our own answer stands.
    expect(await s.claimRoundStart(DATE, "player0001", 0, 1234)).toBe(1234);
    expect(await s.claimAccepted(DATE, "player0001", 0, "mine")).toBe("mine");
    expect(await s.recordFinish(DATE, "player0001", { distance: 1, answers: [] })).toEqual({ first: false, counted: false });
    expect(await s.getPlays(DATE)).toBe(0);
    expect(await s.getDistanceSum(DATE)).toBe(0);
    expect((await s.getDistanceHist(DATE)).size).toBe(0);
    expect((await s.getRoundCounts(DATE, 0)).size).toBe(0);
    const stats = await s.getStats(DATE, 7);
    expect(stats).toMatchObject({ plays: 0, distSum: 0 });
    expect(stats.rounds).toHaveLength(7);
    await expect(s.logRejected(DATE, 0, "k")).resolves.toBeUndefined();
    await expect(s.logFlag(DATE, { i: 0, text: "t", p: "player0001", at: 0 })).rejects.toThrow("down");
    expect(err).toHaveBeenCalledTimes(9);
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

  const store = () => new UpstashStore({ url: "https://redis.example", token: "tok" }, NS);
  const K = `${NS}:${DATE}`;

  it("guards and writes everything in ONE atomic EVAL (no half-applied finish)", async () => {
    const sent = fakeRedis(() => [{ result: 1 }]);
    expect(await store().recordFinish(DATE, "player0001", { distance: 315, answers: ["artist:x", null] }, "abcd")).toEqual({
      first: true,
      counted: true,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      url: "https://redis.example/pipeline",
      auth: "Bearer tok",
      body: [
        [
          "EVAL",
          RECORD_FINISH_LUA,
          "7",
          `${K}:p:player0001`,
          `${K}:src:abcd`,
          `${K}:plays`,
          `${K}:distsum`,
          `${K}:dist`,
          `${K}:r0`,
          `${K}:r1`,
          "259200",
          "259200",
          String(FINISHES_PER_SOURCE),
          "315",
          "artist:x",
          "miss",
        ],
      ],
    });
  });

  it("reads the script's verdict: 0 repeat, 2 over the source cap; no source → cap 0", async () => {
    let reply = 0;
    const sent = fakeRedis(() => [{ result: reply }]);
    expect(await store().recordFinish(DATE, "player0001", { distance: 1, answers: [] })).toEqual({ first: false, counted: false });
    reply = 2;
    expect(await store().recordFinish(DATE, "player0002", { distance: 1, answers: [] }, "abcd")).toEqual({ first: true, counted: false });
    expect(sent[0]!.body).toEqual([
      ["EVAL", RECORD_FINISH_LUA, "5", `${K}:p:player0001`, `${K}:src:-`, `${K}:plays`, `${K}:distsum`, `${K}:dist`, "259200", "259200", "0", "1"],
    ]);
  });

  it("claims round starts and accepted answers with SET NX + GET in one request", async () => {
    const sent = fakeRedis((cmds) => cmds.map((c) => ({ result: c[0] === "SET" ? null : "1000" })));
    expect(await store().claimRoundStart(DATE, "player0001", 2, 5000)).toBe(1000);
    expect(sent[0]!.body).toEqual([
      ["SET", `${K}:s:player0001:2`, "5000", "NX", "EX", "259200"],
      ["GET", `${K}:s:player0001:2`],
    ]);
    fakeRedis((cmds) => cmds.map((c) => ({ result: c[0] === "SET" ? "OK" : "mine" })));
    expect(await store().claimAccepted(DATE, "player0001", 2, "mine")).toBe("mine");
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
      ["GET", `${K}:plays`],
      ["GET", `${K}:distsum`],
      ["HGETALL", `${K}:dist`],
      ["HGETALL", `${K}:r0`],
      ["HGETALL", `${K}:r1`],
    ]);
    expect(stats.plays).toBe(3);
    expect(stats.distSum).toBe(1000);
    expect(Object.fromEntries(stats.hist)).toEqual({ 315: 2, 370: 1 });
    expect(Object.fromEntries(stats.rounds[0]!)).toEqual({ "artist:x": 2, miss: 1 });
    expect(stats.rounds[1]!.size).toBe(0);
  });

  it("logs rejected keys (capped, expiring) and flags (one per player per round, capped per IP)", async () => {
    const sent = fakeRedis((cmds) => cmds.map(() => ({ result: 1 })));
    await store().logRejected(DATE, 2, "berghian");
    await store().logFlag(DATE, { i: 2, text: "Mike Banks", p: "player0001", at: 5 }, "abcd");
    expect(sent[0]!.body).toEqual([["EVAL", LOG_REJECTED_LUA, "1", `${K}:rej2`, "berghian", "2000", "2592000"]]);
    expect(sent[1]!.body).toEqual([
      [
        "EVAL",
        LOG_FLAG_LUA,
        "3",
        `${K}:fl:player0001:2`,
        `${K}:flsrc:abcd`,
        `${K}:flags`,
        "259200",
        "259200",
        "20",
        JSON.stringify({ i: 2, text: "Mike Banks", p: "player0001", at: 5 }),
        "999",
      ],
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
    expect(getStore("production").kind).toBe("memory");
    vi.stubEnv("KV_REST_API_URL", "https://kv.example/");
    vi.stubEnv("KV_REST_API_TOKEN", "t1");
    expect(upstashConfigFromEnv()).toEqual({ url: "https://kv.example", token: "t1" });
    expect(getStore("production").kind).toBe("upstash");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://up.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t2");
    expect(upstashConfigFromEnv()).toEqual({ url: "https://up.example", token: "t2" });
    expect(getStore("production").kind).toBe("upstash");
  });

  it("namespaces by deployment env and pack kind", () => {
    expect(getStore("production").ns).toBe("b:test:production");
    expect(getStore("sample").ns).toBe("b:test:sample");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(getStore("production").ns).toBe("b:preview:production");
  });

  it("production without Redis records nothing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = getStore("production");
    expect(s.kind).toBe("none");
    expect(await s.claimRoundStart(DATE, "player0001", 0, 42)).toBe(42);
  });
});
