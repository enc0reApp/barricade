import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as answerPOST } from "../../app/api/answer/route";
import { POST as finishPOST } from "../../app/api/finish/route";
import { POST as flagPOST } from "../../app/api/flag/route";
import { POST as roundPOST } from "../../app/api/round/route";
import { GET as setGET } from "../../app/api/set/route";
import type { AnswerResponse, FinishResponse, RoundResponse, SetResponse } from "../../lib/api/contract";
import { GRACE_MS } from "../../lib/game/tiers";
import { MemoryStore } from "../../lib/store";
import {
  at,
  call,
  FIXTURE_SAMPLE,
  flush,
  get,
  memory,
  NOW,
  PLAYER_A,
  PLAYER_B,
  PLAYER_C,
  post,
  roundToken,
  setup,
  teardown,
  TODAY,
  YESTERDAY,
} from "./helpers";

type Plan = (string[] | null)[];

/**
 * Plays a whole set like the client does: start each round with the previous
 * round's token + receipt, type each try until one is accepted, and after a
 * missed round let the clock run out (deadline + grace) before moving on.
 */
async function play(date: string, playerId: string, plan: Plan) {
  const receipts: (string | null)[] = [];
  const tokens: string[] = [];
  const answers: AnswerResponse[][] = [];
  for (let index = 0; index < plan.length; index++) {
    const prev = index > 0 ? { prevToken: tokens[index - 1], prevReceipt: receipts[index - 1] ?? null } : {};
    const r = await call<RoundResponse>(roundPOST, post("/api/round", { date, index, playerId, ...prev }));
    expect(r.status).toBe(200);
    if (!r.body.ok) throw new Error(`round ${index} failed: ${r.body.error}`);
    const tries = plan[index] ?? [];
    const results: AnswerResponse[] = [];
    let receipt: string | null = null;
    for (const text of tries) {
      const a = await call<AnswerResponse>(answerPOST, post("/api/answer", { token: r.body.token, text }));
      results.push(a.body);
      if (a.body.ok && a.body.status === "accepted") {
        receipt = a.body.receipt;
        break;
      }
    }
    if (receipt === null) at(r.body.deadline + GRACE_MS + 1);
    receipts.push(receipt);
    tokens.push(r.body.token);
    answers.push(results);
  }
  return { receipts, tokens, answers };
}

const finish = (date: string, playerId: string, receipts: unknown, tokens?: unknown, headers?: Record<string, string>) =>
  call<FinishResponse>(finishPOST, post("/api/finish", { date, playerId, receipts, ...(tokens === undefined ? {} : { tokens }) }, headers));

// Puzzle #2: detroit artists, detroit labels, ibiza clubs, tomorrowland countries,
// boiler room cities, roland synths, dutch festivals.
const PLAN_A: Plan = [["Jeff Mills"], ["FXHE"], ["Cova Santa"], ["Brazil"], ["Tbilisi"], ["Nonsense Synth", "JX-3P"], null];
// main 10 + htbt 100 + htbt 100 + side 30 + basement 85 + tent 60 + miss 0 = 385 → 315m
const DIST_A = 315;

beforeEach(() => setup());
afterEach(() => teardown());

describe("GET /api/set", () => {
  it("describes today's set without leaking prompts", async () => {
    const { status, body } = await call<SetResponse>(setGET, get(`/api/set?date=${TODAY}`));
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      number: 2,
      date: TODAY,
      rounds: 7,
      seconds: [25, 25, 25, 25, 25, 25, 25],
      mode: "today",
      pack: "production",
      latestNumber: 2,
      epoch: "2026-11-09",
    });
  });

  it("archive mode, title and per-round seconds for an earlier set", async () => {
    const { body } = await call<SetResponse>(setGET, get(`/api/set?date=${YESTERDAY}`));
    expect(body).toMatchObject({ ok: true, number: 1, mode: "archive", title: "FIXTURE ONE" });
    if (body.ok) expect(body.seconds[6]).toBe(20);
  });

  it("refuses bad, future and unscheduled dates", async () => {
    for (const q of ["", "?date=", "?date=nope", "?date=2026-02-30", "?date=2026-11-1"]) {
      const r = await call(setGET, get(`/api/set${q}`));
      expect(r).toEqual({ status: 400, body: { ok: false, error: "bad-date" } });
    }
    expect(await call(setGET, get("/api/set?date=2026-11-12"))).toEqual({ status: 403, body: { ok: false, error: "future" } });
    expect(await call(setGET, get("/api/set?date=2026-11-11"))).toEqual({
      status: 404,
      body: { ok: false, error: "no-set", epoch: expect.any(String), latestNumber: expect.any(Number) },
    });
    expect(await call(setGET, get("/api/set?date=2026-11-08"))).toMatchObject({ status: 404, body: { ok: false, error: "no-set" } });
  });
});

describe("POST /api/round", () => {
  it("returns one prompt, a token and a server-clock deadline", async () => {
    const { status, body } = await call<RoundResponse>(roundPOST, post("/api/round", { date: YESTERDAY, index: 6, playerId: PLAYER_A }));
    expect(status).toBe(200);
    if (!body.ok) throw new Error(body.error);
    expect(body.prompt).toEqual({
      index: 6,
      total: 7,
      text: "Name a stage or area at Glastonbury",
      types: ["stage"],
      seconds: 20,
    });
    expect(body.serverNow).toBe(NOW);
    expect(body.deadline).toBe(NOW + 20_000);
    expect(typeof body.token).toBe("string");
    expect(JSON.stringify(body)).not.toContain("Pyramid");
  });

  it("validates input", async () => {
    const bad = [
      { date: TODAY, index: 0, playerId: "short" },
      { date: TODAY, index: 0, playerId: "has spaces in it" },
      { date: TODAY, index: -1, playerId: PLAYER_A },
      { date: TODAY, index: 1.5, playerId: PLAYER_A },
      { date: TODAY, index: "0", playerId: PLAYER_A },
      { date: TODAY, index: 7, playerId: PLAYER_A },
    ];
    for (const b of bad) expect((await call(roundPOST, post("/api/round", b))).body).toMatchObject({ ok: false, error: "bad-request" });
    expect((await call(roundPOST, post("/api/round", "{not json"))).body).toEqual({ ok: false, error: "bad-request" });
    expect((await call(roundPOST, post("/api/round", "[1,2]"))).body).toEqual({ ok: false, error: "bad-request" });
    expect((await call(roundPOST, post("/api/round", { date: "x", index: 0, playerId: PLAYER_A }))).body.error).toBe("bad-date");
    expect((await call(roundPOST, post("/api/round", { date: "2026-11-12", index: 0, playerId: PLAYER_A }))).body.error).toBe("future");
    const huge = post("/api/round", { date: TODAY, index: 0, playerId: PLAYER_A, pad: "x".repeat(20_000) });
    expect((await call(roundPOST, huge)).body.error).toBe("bad-request");
  });

  it("reports a missing secret in production as a server error", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BARRICADE_SECRET", "");
    const r = await call(roundPOST, post("/api/round", { date: TODAY, index: 0, playerId: PLAYER_A }));
    expect(r).toEqual({ status: 500, body: { ok: false, error: "server", message: "BARRICADE_SECRET not set" } });
  });
});

describe("POST /api/answer", () => {
  async function start(index = 0, date = TODAY, playerId = PLAYER_A) {
    const prev = index > 0 ? { prevToken: await roundToken(date, index - 1, playerId), prevReceipt: null } : {};
    const r = await call<RoundResponse>(roundPOST, post("/api/round", { date, index, playerId, ...prev }));
    if (!r.body.ok) throw new Error(r.body.error);
    return r.body.token;
  }
  const answer = (token: string, text: unknown) => call<AnswerResponse>(answerPOST, post("/api/answer", { token, text }));

  it("accepts, with tier, points, share and a receipt", async () => {
    const token = await start(1);
    const { body } = await answer(token, "fxhe");
    expect(body).toMatchObject({
      ok: true,
      status: "accepted",
      answer: { id: "label:fxhe", name: "FXHE", type: "label", tier: "htbt", points: 100, share: 0.0006, note: "Omar S's own label" },
    });
    if (body.ok && body.status === "accepted") expect(body.receipt).toMatch(/^v2\./);
  });

  it("rejects unknown, off-prompt (with canonical) and empty — and logs the misses", async () => {
    const token = await start(0);
    expect((await answer(token, "Somebody Nobody Knows")).body).toEqual({ ok: true, status: "rejected", reason: "unknown" });
    expect((await answer(token, "Berghain")).body).toEqual({
      ok: true,
      status: "rejected",
      reason: "offprompt",
      canonical: { name: "Berghain", type: "venue" },
    });
    expect((await answer(token, "  ")).body).toEqual({ ok: true, status: "rejected", reason: "empty" });
    expect((await answer(token, "x".repeat(60))).body).toMatchObject({ status: "rejected", reason: "unknown" });
    await flush();
    const logged = memory.rejected(TODAY, 0);
    expect(Object.fromEntries(logged)).toEqual({ somebodynobodyknows: 1, berghain: 1 }); // 60-char key not logged
  });

  it("expires after the deadline plus grace — the server owns the clock", async () => {
    const token = await start(2);
    at(NOW + 25_000 + GRACE_MS); // last allowed instant
    expect((await answer(token, "Amnesia")).body).toMatchObject({ status: "accepted" });
    at(NOW + 25_000 + GRACE_MS + 1);
    expect((await answer(token, "Amnesia")).body).toEqual({ ok: true, status: "expired" });
  });

  it("refuses bad tokens and bad bodies", async () => {
    const token = await start(0);
    expect((await answer("v1.nope.nope", "Jeff Mills")).body).toEqual({ ok: false, error: "bad-token" });
    expect((await answer(token.slice(0, -3) + "abc", "Jeff Mills")).body).toEqual({ ok: false, error: "bad-token" });
    expect((await answer(token, 42)).body).toEqual({ ok: false, error: "bad-request" });
    expect((await call(answerPOST, post("/api/answer", "nope"))).body).toEqual({ ok: false, error: "bad-request" });
  });
});

describe("POST /api/finish", () => {
  it("happy path: 7 rounds → answers → finish → reveal + crowd", async () => {
    const set = await call<SetResponse>(setGET, get(`/api/set?date=${TODAY}`));
    expect(set.body.ok && set.body.mode).toBe("today");

    const { receipts, tokens, answers } = await play(TODAY, PLAYER_A, PLAN_A);
    expect(answers[5]!.map((a) => (a.ok && a.status === "rejected" ? a.reason : a.ok && a.status))).toEqual(["unknown", "accepted"]);
    expect(receipts.filter(Boolean)).toHaveLength(6);

    const { status, body } = await finish(TODAY, PLAYER_A, receipts, tokens);
    expect(status).toBe(200);
    if (!body.ok) throw new Error(body.error);
    expect(body).toMatchObject({ number: 2, date: TODAY, mode: "today", distance: DIST_A });
    expect(body.outcomes).toEqual(["main", "htbt", "htbt", "side", "basement", "tent", "miss"]);
    expect(body.crowd).toEqual({ plays: 1, beatPct: 0 });
    expect(body.rounds).toHaveLength(7);
    const r0 = body.rounds[0]!;
    expect(r0.yours).toMatchObject({ id: "artist:jeff-mills", name: "Jeff Mills", tier: "main", points: 10, crowdPct: null });
    expect(r0.picks.map((p) => p.name)).not.toContain("Jeff Mills");
    expect(r0.picks.length).toBeGreaterThan(0);
    expect(r0.total).toBe(12);
    expect(body.rounds[6]!.yours).toBeNull();
    expect(body.rounds[2]!.hint).toBe("Defunct ones count.");

    // Stats were written once, in the documented key layout.
    const stats = await memory.getStats(TODAY, 7);
    expect(stats.plays).toBe(1);
    expect(stats.distSum).toBe(DIST_A);
    expect(Object.fromEntries(stats.hist)).toEqual({ [DIST_A]: 1 });
    expect(Object.fromEntries(stats.rounds[0]!)).toEqual({ "artist:jeff-mills": 1 });
    expect(Object.fromEntries(stats.rounds[6]!)).toEqual({ miss: 1 });

    // A repeat finish is answered but not counted again.
    const again = await finish(TODAY, PLAYER_A, receipts, tokens);
    expect(again.body).toMatchObject({ ok: true, distance: DIST_A, crowd: { plays: 1, beatPct: 0 } });
    expect((await memory.getStats(TODAY, 7)).plays).toBe(1);

    // B plays and times out every round (700m); C matches A (315m) → C beat 1 of 3.
    const bp = await play(TODAY, PLAYER_B, Array(7).fill(null));
    const b = await finish(TODAY, PLAYER_B, bp.receipts, bp.tokens);
    expect(b.body).toMatchObject({ ok: true, distance: 700, outcomes: Array(7).fill("miss"), crowd: { plays: 2, beatPct: 0 } });
    const c = await play(TODAY, PLAYER_C, PLAN_A);
    const cf = await finish(TODAY, PLAYER_C, c.receipts, c.tokens);
    expect(cf.body).toMatchObject({ ok: true, distance: DIST_A, crowd: { plays: 3, beatPct: 33.3 } });
  });

  it("shows per-round crowd % once 20 players have finished", async () => {
    for (let n = 0; n < 19; n++) {
      await memory.recordFinish(TODAY, `seedplayer${String(n).padStart(4, "0")}`, {
        distance: 690,
        answers: [n < 5 ? "artist:jeff-mills" : "artist:juan-atkins", null, null, null, null, null, null],
      });
    }
    const { receipts, tokens } = await play(TODAY, PLAYER_A, PLAN_A);
    const { body } = await finish(TODAY, PLAYER_A, receipts, tokens);
    if (!body.ok) throw new Error(body.error);
    expect(body.crowd).toEqual({ plays: 20, beatPct: 95 });
    expect(body.rounds[0]!.yours?.crowdPct).toBe(30); // 6 of 20
    expect(body.rounds[1]!.yours?.crowdPct).toBe(5); // 1 of 20
  });

  it("refuses a forged receipt", async () => {
    const { receipts } = await play(TODAY, PLAYER_A, PLAN_A);
    // Upgrade round 0 (Jeff Mills, main) to htbt without re-signing.
    const [v, payload, sig] = receipts[0]!.split(".") as [string, string, string];
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>;
    const upgraded = Buffer.from(JSON.stringify({ ...decoded, t: "htbt" })).toString("base64url");
    const forged = [...receipts];
    forged[0] = `${v}.${upgraded}.${sig}`;
    expect(await finish(TODAY, PLAYER_A, forged)).toEqual({ status: 400, body: { ok: false, error: "bad-receipt" } });
    forged[0] = "v1.made.up";
    expect((await finish(TODAY, PLAYER_A, forged)).body).toEqual({ ok: false, error: "bad-receipt" });
    expect((await memory.getStats(TODAY, 7)).plays).toBe(0);
  });

  it("refuses receipts from another player, another round or another date", async () => {
    const { receipts } = await play(TODAY, PLAYER_A, PLAN_A);
    expect((await finish(TODAY, PLAYER_B, receipts)).body).toEqual({ ok: false, error: "bad-receipt" });
    const swapped = [receipts[1], receipts[0], ...receipts.slice(2)];
    expect((await finish(TODAY, PLAYER_A, swapped)).body).toEqual({ ok: false, error: "bad-receipt" });
    expect((await finish(YESTERDAY, PLAYER_A, receipts)).body).toEqual({ ok: false, error: "bad-receipt" });
    expect((await memory.getStats(TODAY, 7)).plays).toBe(0);
  });

  it("validates the request", async () => {
    const seven = Array(7).fill(null);
    expect((await finish(TODAY, PLAYER_A, seven.slice(1))).body).toMatchObject({ ok: false, error: "bad-request" });
    expect((await finish(TODAY, PLAYER_A, [...seven, null])).body).toMatchObject({ ok: false, error: "bad-request" });
    expect((await finish(TODAY, PLAYER_A, "nope")).body).toEqual({ ok: false, error: "bad-request" });
    expect((await finish(TODAY, PLAYER_A, [1, 2, 3, 4, 5, 6, 7])).body).toEqual({ ok: false, error: "bad-request" });
    expect((await finish(TODAY, "bad id", seven)).body).toEqual({ ok: false, error: "bad-request" });
    expect((await finish("2026-11-12", PLAYER_A, seven)).body).toEqual({ ok: false, error: "future" });
    expect((await finish("2026-11-11", PLAYER_A, seven)).body).toEqual({ ok: false, error: "no-set" });
  });

  it("archive mode reveals but never records", async () => {
    at(NOW + 3_600_000); // an hour after 2026-11-09 closed everywhere
    const { receipts } = await play(YESTERDAY, PLAYER_A, [["Glasto"], ["Berghain"], ["House"], ["Chicago"], ["F1"], ["808"], ["Pyramid"]]);
    const { body } = await finish(YESTERDAY, PLAYER_A, receipts);
    if (!body.ok) throw new Error(body.error);
    expect(body.mode).toBe("archive");
    expect(body.distance).toBe(630);
    expect(body.crowd).toEqual({ plays: null, beatPct: null });
    expect(body.rounds.every((r) => r.yours?.crowdPct === null)).toBe(true);
    expect((await memory.getStats(YESTERDAY, 7)).plays).toBe(0);
  });

  it("finish agrees with /api/set on the mode at the closing instant", async () => {
    // 2026-11-09 closes everywhere at exactly 2026-11-10T12:00Z (= NOW).
    const set = await call<SetResponse>(setGET, get(`/api/set?date=${YESTERDAY}`));
    const { body } = await finish(YESTERDAY, PLAYER_A, Array(7).fill(null));
    expect(set.body).toMatchObject({ mode: "archive" });
    expect(body).toMatchObject({ ok: true, mode: "archive", crowd: { plays: null } });
  });
});

describe("POST /api/flag", () => {
  it("logs a capped report for editors", async () => {
    const text = `  Should count: ${"Juan Atkins ".repeat(10)}`;
    expect(await call(flagPOST, post("/api/flag", { date: TODAY, index: 0, text, playerId: PLAYER_A }))).toEqual({
      status: 200,
      body: { ok: true },
    });
    const [flag] = memory.flags(TODAY);
    expect(flag).toMatchObject({ i: 0, p: PLAYER_A, at: NOW });
    expect(flag!.text.length).toBe(80);
    expect(flag!.text.startsWith("Should count:")).toBe(true);
  });

  it("validates", async () => {
    const ok = { date: TODAY, index: 0, text: "Mike Banks", playerId: PLAYER_A };
    expect((await call(flagPOST, post("/api/flag", { ...ok, text: "   " }))).body).toEqual({ ok: false, error: "bad-request" });
    expect((await call(flagPOST, post("/api/flag", { ...ok, text: 5 }))).body).toEqual({ ok: false, error: "bad-request" });
    expect((await call(flagPOST, post("/api/flag", { ...ok, index: 9 }))).body).toMatchObject({ ok: false, error: "bad-request" });
    expect((await call(flagPOST, post("/api/flag", { ...ok, playerId: "x" }))).body).toEqual({ ok: false, error: "bad-request" });
    expect((await call(flagPOST, post("/api/flag", { ...ok, date: "2026-11-12" }))).body).toEqual({ ok: false, error: "future" });
    expect(memory.flags(TODAY)).toHaveLength(0);
  });
});

describe("store failures never break gameplay", () => {
  it("finishes and answers even when every store call throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const down = new Error("redis down");
    vi.spyOn(MemoryStore.prototype, "recordFinish").mockRejectedValue(down);
    vi.spyOn(MemoryStore.prototype, "getStats").mockRejectedValue(down);
    vi.spyOn(MemoryStore.prototype, "logRejected").mockRejectedValue(down);
    const { receipts, tokens } = await play(TODAY, PLAYER_A, PLAN_A);
    await flush();
    const { body } = await finish(TODAY, PLAYER_A, receipts, tokens);
    expect(body).toMatchObject({ ok: true, distance: DIST_A, crowd: { plays: 0, beatPct: null } });
    expect(err).toHaveBeenCalled();
  });
});

describe("sample pack floats onto any date", () => {
  beforeEach(() => setup(FIXTURE_SAMPLE));

  it("maps every date from its epoch onto its few sets, re-numbered", async () => {
    // epoch 2026-11-01 → 2026-11-10 is #10 → puzzles[(10-1) % 2] = the second set.
    const today = await call<SetResponse>(setGET, get(`/api/set?date=${TODAY}`));
    expect(today.body).toMatchObject({ ok: true, number: 10, date: TODAY, mode: "today", pack: "sample", latestNumber: 11 });
    expect("title" in today.body).toBe(false);
    const fifth = await call<SetResponse>(setGET, get("/api/set?date=2026-11-05"));
    expect(fifth.body).toMatchObject({ ok: true, number: 5, mode: "archive", title: "FIXTURE ONE" });
    expect((await call(setGET, get("/api/set?date=2026-10-31"))).body).toMatchObject({ ok: false, error: "no-set" });
    // 2026-11-11 is live somewhere and the sample has no end.
    expect((await call(setGET, get("/api/set?date=2026-11-11"))).body).toMatchObject({ ok: true, number: 11 });
  });

  it("plays a floating set end to end", async () => {
    const { receipts, tokens } = await play(TODAY, PLAYER_A, PLAN_A);
    const { body } = await finish(TODAY, PLAYER_A, receipts, tokens);
    expect(body).toMatchObject({ ok: true, number: 10, date: TODAY, distance: DIST_A, mode: "today" });
  });
});
