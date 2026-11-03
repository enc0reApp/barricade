/**
 * Regression tests for the review fixes on the API surface: proof of play
 * (C0), pack-bound tokens (C2), per-IP caps (C3, C5), bounded rejected-try
 * logging (C4), namespaced stats (C10/C21), no future-set spoilers (S0), no
 * clock restarts and one receipt per round.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as answerPOST } from "../../app/api/answer/route";
import { POST as finishPOST } from "../../app/api/finish/route";
import { POST as flagPOST } from "../../app/api/flag/route";
import { POST as roundPOST } from "../../app/api/round/route";
import { GET as setGET } from "../../app/api/set/route";
import type { AnswerResponse, FinishResponse, RoundResponse } from "../../lib/api/contract";
import { getLoadedPack, resetPackCache } from "../../lib/content/loader";
import { GRACE_MS } from "../../lib/game/tiers";
import { signReceipt, signRound } from "../../lib/game/token";
import { clientSource } from "../../lib/server/http";
import { FINISHES_PER_SOURCE, FLAGS_PER_SOURCE } from "../../lib/store";
import {
  at,
  call,
  FIXTURE_PACK,
  FIXTURE_SAMPLE,
  flush,
  get,
  memory,
  NOW,
  NS_PRODUCTION,
  NS_SAMPLE,
  PLAYER_A,
  PLAYER_B,
  post,
  sampleMemory,
  setup,
  teardown,
  TODAY,
  YESTERDAY,
} from "./helpers";

beforeEach(() => setup());
afterEach(() => teardown());

const round = (body: Record<string, unknown>) => call<RoundResponse>(roundPOST, post("/api/round", body));
const answer = (token: string, text: string) => call<AnswerResponse>(answerPOST, post("/api/answer", { token, text }));
const finish = (body: Record<string, unknown>, headers?: Record<string, string>) =>
  call<FinishResponse>(finishPOST, post("/api/finish", body, headers));

async function started(body: Record<string, unknown>) {
  const r = await round(body);
  if (!r.body.ok) throw new Error(`round failed: ${r.body.error} ${r.body.message ?? ""}`);
  return r.body;
}

/** Starts and times out all 7 rounds (no answers), the slowest legitimate path to a reveal. */
async function timeOutAll(playerId: string, date = TODAY) {
  const tokens: string[] = [];
  for (let index = 0; index < 7; index++) {
    const prev = index > 0 ? { prevToken: tokens[index - 1], prevReceipt: null } : {};
    const r = await started({ date, index, playerId, ...prev });
    tokens.push(r.token);
    at(r.deadline + GRACE_MS + 1);
  }
  return tokens;
}

/** Answers every round instantly with the given texts. */
async function answerAll(playerId: string, texts: string[], date = TODAY) {
  const tokens: string[] = [];
  const receipts: (string | null)[] = [];
  for (let index = 0; index < texts.length; index++) {
    const prev = index > 0 ? { prevToken: tokens[index - 1], prevReceipt: receipts[index - 1] } : {};
    const r = await started({ date, index, playerId, ...prev });
    tokens.push(r.token);
    const a = await answer(r.token, texts[index]!);
    receipts.push(a.body.ok && a.body.status === "accepted" ? a.body.receipt : null);
    if (receipts[index] === null) at(r.deadline + GRACE_MS + 1);
  }
  return { tokens, receipts };
}

// One accepted answer per round of puzzle #2 (all main/side stage).
const EASY = ["Jeff Mills", "Motown", "Pacha", "Brazil", "London", "TB-303", "Defqon.1"];

describe("C1/C20 — production never quietly serves the public sample", () => {
  it("every route answers server / 'content pack not configured'", async () => {
    setup(FIXTURE_SAMPLE);
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await call(setGET, get(`/api/set?date=${TODAY}`));
    expect(r).toEqual({ status: 500, body: { ok: false, error: "server", message: "content pack not configured" } });
    expect((await round({ date: TODAY, index: 0, playerId: PLAYER_A })).body).toMatchObject({ error: "server" });
    vi.stubEnv("BARRICADE_ALLOW_SAMPLE", "1");
    resetPackCache();
    expect((await call(setGET, get(`/api/set?date=${TODAY}`))).body).toMatchObject({ ok: true, pack: "sample" });
  });
});

describe("C0 — proof of play before the reveal (today mode)", () => {
  it("refuses an all-null finish without round tokens — no picks, nothing recorded", async () => {
    const r = await finish({ date: TODAY, playerId: PLAYER_A, receipts: Array(7).fill(null) });
    expect(r).toEqual({ status: 400, body: { ok: false, error: "bad-request", message: "round tokens required" } });
    expect(JSON.stringify(r.body)).not.toContain("picks");
    expect((await memory.getStats(TODAY, 7)).plays).toBe(0);
  });

  it("refuses a finish before a missed round's clock (deadline + grace) has run out", async () => {
    const tokens = await timeOutAll(PLAYER_A);
    // timeOutAll left the clock 1ms past round 6's deadline + grace; step back inside it.
    at(Date.now() - 2);
    const early = await finish({ date: TODAY, playerId: PLAYER_A, receipts: Array(7).fill(null), tokens });
    expect(early.body).toEqual({ ok: false, error: "bad-request", message: "round still running" });
    at(Date.now() + 2);
    const ok = await finish({ date: TODAY, playerId: PLAYER_A, receipts: Array(7).fill(null), tokens });
    expect(ok.body).toMatchObject({ ok: true, mode: "today", distance: 700, crowd: { plays: 1 } });
  });

  it("refuses tokens of another player, round, date or pack", async () => {
    const tokens = await timeOutAll(PLAYER_A);
    const nulls = Array(7).fill(null);
    expect((await finish({ date: TODAY, playerId: PLAYER_B, receipts: nulls, tokens })).body).toEqual({ ok: false, error: "bad-token" });
    const swapped = [tokens[1], tokens[0], ...tokens.slice(2)];
    expect((await finish({ date: TODAY, playerId: PLAYER_A, receipts: nulls, tokens: swapped })).body).toEqual({ ok: false, error: "bad-token" });
    expect((await finish({ date: TODAY, playerId: PLAYER_A, receipts: nulls, tokens: tokens.slice(1) })).body).toMatchObject({
      ok: false,
      error: "bad-request",
    });
    const otherPack = [...tokens];
    otherPack[3] = signRound({ d: TODAY, i: 3, n: 2, s: NOW, p: PLAYER_A, h: "otherpack01" });
    expect((await finish({ date: TODAY, playerId: PLAYER_A, receipts: nulls, tokens: otherPack })).body).toEqual({ ok: false, error: "bad-token" });
    expect((await memory.getStats(TODAY, 7)).plays).toBe(0);
  });

  it("archive finishes still need no tokens", async () => {
    at(NOW + 3_600_000);
    const r = await finish({ date: YESTERDAY, playerId: PLAYER_A, receipts: Array(7).fill(null) });
    expect(r.body).toMatchObject({ ok: true, mode: "archive", distance: 700 });
  });
});

describe("C0 — /api/round needs the previous round to be over (today mode)", () => {
  it("refuses round i > 0 without a matching previous-round token", async () => {
    const r0 = await started({ date: TODAY, index: 0, playerId: PLAYER_A });
    expect((await round({ date: TODAY, index: 1, playerId: PLAYER_A })).body).toMatchObject({ ok: false, error: "bad-token" });
    // Another player's token, or the wrong round's, doesn't count.
    expect((await round({ date: TODAY, index: 1, playerId: PLAYER_B, prevToken: r0.token })).body).toMatchObject({ error: "bad-token" });
    expect((await round({ date: TODAY, index: 2, playerId: PLAYER_A, prevToken: r0.token })).body).toMatchObject({ error: "bad-token" });
    expect((await round({ date: TODAY, index: 1, playerId: PLAYER_A, prevToken: 42 })).body).toMatchObject({ error: "bad-request" });
  });

  it("without a receipt, round i-1's clock (deadline + grace) must have run out", async () => {
    const r0 = await started({ date: TODAY, index: 0, playerId: PLAYER_A });
    at(r0.deadline + GRACE_MS);
    expect((await round({ date: TODAY, index: 1, playerId: PLAYER_A, prevToken: r0.token, prevReceipt: null })).body).toEqual({
      ok: false,
      error: "bad-request",
      message: "previous round is still running",
    });
    at(r0.deadline + GRACE_MS + 1);
    expect((await round({ date: TODAY, index: 1, playerId: PLAYER_A, prevToken: r0.token, prevReceipt: null })).body).toMatchObject({
      ok: true,
    });
  });

  it("with a valid receipt for round i-1 the next round opens at once", async () => {
    const r0 = await started({ date: TODAY, index: 0, playerId: PLAYER_A });
    const a = await answer(r0.token, "Jeff Mills");
    if (!a.body.ok || a.body.status !== "accepted") throw new Error("not accepted");
    expect((await round({ date: TODAY, index: 1, playerId: PLAYER_A, prevToken: r0.token, prevReceipt: a.body.receipt })).body).toMatchObject({
      ok: true,
    });
    expect((await round({ date: TODAY, index: 1, playerId: PLAYER_A, prevToken: r0.token, prevReceipt: "v2.forged.receipt" })).body).toEqual({
      ok: false,
      error: "bad-receipt",
    });
  });

  it("archive rounds open in any order", async () => {
    at(NOW + 3_600_000);
    expect((await round({ date: YESTERDAY, index: 5, playerId: PLAYER_A })).body).toMatchObject({ ok: true });
  });
});

describe("no clock restarts, one receipt per round (today mode, with a store)", () => {
  it("asking for the same round again returns the ORIGINAL start and deadline", async () => {
    const first = await started({ date: TODAY, index: 0, playerId: PLAYER_A });
    at(NOW + 20_000);
    const again = await started({ date: TODAY, index: 0, playerId: PLAYER_A });
    expect(again.deadline).toBe(first.deadline);
    expect(again.serverNow).toBe(NOW + 20_000);
    at(first.deadline + GRACE_MS + 1);
    expect((await answer(again.token, "Jeff Mills")).body).toEqual({ ok: true, status: "expired" });
    // Another player starts fresh.
    expect((await started({ date: TODAY, index: 0, playerId: PLAYER_B })).deadline).toBe(first.deadline + GRACE_MS + 1 + 25_000);
  });

  it("a second accepted answer gets the first answer and receipt back", async () => {
    const r0 = await started({ date: TODAY, index: 0, playerId: PLAYER_A });
    const a = await answer(r0.token, "Jeff Mills");
    const b = await answer(r0.token, "Drexciya");
    expect(a.body).toMatchObject({ status: "accepted", answer: { id: "artist:jeff-mills" } });
    expect(b.body).toEqual(a.body);
    // Rejections still answer normally.
    expect((await answer(r0.token, "Nobody At All")).body).toMatchObject({ status: "rejected", reason: "unknown" });
  });
});

describe("C2 — tokens and receipts are bound to the pack", () => {
  it("a receipt minted on the sample pack never scores on production (same secret)", async () => {
    setup(FIXTURE_SAMPLE);
    const sample = await answerAll(PLAYER_A, EASY);
    expect(sample.receipts.every(Boolean)).toBe(true);
    vi.stubEnv("BARRICADE_PACK_PATH", FIXTURE_PACK);
    resetPackCache();
    const r = await finish({ date: TODAY, playerId: PLAYER_A, receipts: sample.receipts, tokens: sample.tokens });
    expect(r.body).toEqual({ ok: false, error: "bad-receipt" });
    // …and the sample's round tokens are refused by /api/answer too.
    expect((await answer(sample.tokens[0]!, "Jeff Mills")).body).toEqual({ ok: false, error: "bad-token" });
  });

  it("a receipt for another puzzle number is refused", async () => {
    const { id } = await getLoadedPack();
    const tokens = await timeOutAll(PLAYER_A);
    const receipts: (string | null)[] = Array(7).fill(null);
    receipts[0] = signReceipt({ d: TODAY, i: 0, n: 1, a: "artist:jeff-mills", t: "htbt", p: PLAYER_A, h: id });
    expect((await finish({ date: TODAY, playerId: PLAYER_A, receipts, tokens })).body).toEqual({ ok: false, error: "bad-receipt" });
  });
});

describe("C3 — per-IP cap on counted finishes", () => {
  it("past the cap the reveal is unchanged but nothing is counted", async () => {
    const headers = { "x-forwarded-for": "203.0.113.7, 10.0.0.1" };
    const source = clientSource(post("/x", {}, headers));
    expect(source).toMatch(/^[0-9a-f]{16}$/);
    for (let n = 0; n < FINISHES_PER_SOURCE; n++) {
      const outcome = await memory.recordFinish(TODAY, `seedplayer${String(n).padStart(4, "0")}`, { distance: 700, answers: Array(7).fill(null) }, source);
      expect(outcome).toEqual({ first: true, counted: true });
    }
    const { tokens, receipts } = await answerAll(PLAYER_A, EASY);
    const r = await finish({ date: TODAY, playerId: PLAYER_A, receipts, tokens }, headers);
    if (!r.body.ok) throw new Error(r.body.error);
    expect(r.body.outcomes.every((o) => o !== "miss")).toBe(true);
    expect(r.body.rounds).toHaveLength(7);
    expect(r.body.crowd.plays).toBe(FINISHES_PER_SOURCE);
    expect((await memory.getStats(TODAY, 7)).plays).toBe(FINISHES_PER_SOURCE);
    // Another network still counts.
    const b = await answerAll(PLAYER_B, EASY);
    const rb = await finish({ date: TODAY, playerId: PLAYER_B, receipts: b.receipts, tokens: b.tokens }, { "x-real-ip": "198.51.100.2" });
    expect(rb.body).toMatchObject({ ok: true, crowd: { plays: FINISHES_PER_SOURCE + 1 } });
  });

  it("hashes the first forwarded hop, folds IPv6 to its /64, and ignores junk", () => {
    const src = (h: Record<string, string>) => clientSource(post("/x", {}, h));
    expect(src({ "x-forwarded-for": "203.0.113.7" })).toBe(src({ "x-forwarded-for": "203.0.113.7, 1.2.3.4" }));
    expect(src({ "x-forwarded-for": "203.0.113.7" })).toBe(src({ "x-real-ip": "203.0.113.7" }));
    expect(src({ "x-forwarded-for": "203.0.113.7" })).not.toBe(src({ "x-forwarded-for": "203.0.113.8" }));
    expect(src({ "x-forwarded-for": "2001:db8:1:2::1" })).toBe(src({ "x-forwarded-for": "2001:db8:1:2:ffff:0:0:9" }));
    expect(src({ "x-forwarded-for": "2001:db8:1:2::1" })).not.toBe(src({ "x-forwarded-for": "2001:db8:1:3::1" }));
    expect(src({ "x-forwarded-for": "::ffff:203.0.113.7" })).toBe(src({ "x-forwarded-for": "203.0.113.7" }));
    expect(src({})).toBeNull();
    expect(src({ "x-forwarded-for": "not an ip" })).toBeNull();
  });
});

describe("C4 — rejected tries are logged only while the set is live", () => {
  it("archive rounds log nothing", async () => {
    at(NOW + 3_600_000);
    const r = await started({ date: YESTERDAY, index: 0, playerId: PLAYER_A });
    expect((await answer(r.token, "Somebody Nobody Knows")).body).toMatchObject({ reason: "unknown" });
    await flush();
    expect(memory.rejected(YESTERDAY, 0).size).toBe(0);
  });
});

describe("C5 — flags: one per player per round, capped per IP", () => {
  const flag = (playerId: string, index: number, text: string, headers?: Record<string, string>) =>
    call(flagPOST, post("/api/flag", { date: TODAY, index, text, playerId }, headers));

  it("a second flag from the same player and round is answered but not logged", async () => {
    expect((await flag(PLAYER_A, 0, "Mike Banks")).body).toEqual({ ok: true });
    expect((await flag(PLAYER_A, 0, "Mike Banks again")).body).toEqual({ ok: true });
    expect((await flag(PLAYER_A, 1, "Other round")).body).toEqual({ ok: true });
    expect(memory.flags(TODAY).map((f) => f.text)).toEqual(["Other round", "Mike Banks"]);
  });

  it("one IP can add at most FLAGS_PER_SOURCE reports per date", async () => {
    const headers = { "x-forwarded-for": "203.0.113.9" };
    for (let n = 0; n < FLAGS_PER_SOURCE + 5; n++) {
      expect((await flag(`flooder${String(n).padStart(4, "0")}`, 0, `junk ${n}`, headers)).body).toEqual({ ok: true });
    }
    expect(memory.flags(TODAY)).toHaveLength(FLAGS_PER_SOURCE);
    await flag(PLAYER_B, 0, "A real report", { "x-forwarded-for": "198.51.100.3" });
    expect(memory.flags(TODAY)[0]!.text).toBe("A real report");
  });
});

describe("C10/C21 — stats keys are namespaced by env and pack kind", () => {
  it("production-pack plays land under b:{env}:production, sample plays under b:{env}:sample", async () => {
    const { tokens, receipts } = await answerAll(PLAYER_A, EASY);
    await finish({ date: TODAY, playerId: PLAYER_A, receipts, tokens });
    expect(NS_PRODUCTION).toBe("b:test:production");
    const prodKeys = memory.allKeys();
    expect(prodKeys.length).toBeGreaterThan(0);
    expect(prodKeys.every((k) => k.startsWith(`${NS_PRODUCTION}:${TODAY}:`))).toBe(true);

    setup(FIXTURE_SAMPLE);
    const s = await answerAll(PLAYER_A, EASY);
    const r = await finish({ date: TODAY, playerId: PLAYER_A, receipts: s.receipts, tokens: s.tokens });
    expect(r.body).toMatchObject({ ok: true, crowd: { plays: 1 } }); // not blocked by the production guard
    expect((await sampleMemory.getStats(TODAY, 7)).plays).toBe(1);
    expect((await memory.getStats(TODAY, 7)).plays).toBe(0);
    expect(memory.allKeys().every((k) => k.startsWith(`${NS_SAMPLE}:${TODAY}:`))).toBe(true);
  });
});

describe("S0 — off-prompt replies never name an answer from a later set", () => {
  it("on 11-09 an answer that only exists in 11-10's set is 'unknown'; on 11-10 an earlier answer is off-prompt", async () => {
    at(NOW + 3_600_000); // both sets playable; 11-09 is archive
    const old = await started({ date: YESTERDAY, index: 0, playerId: PLAYER_A }); // UK festivals
    expect((await answer(old.token, "Jeff Mills")).body).toEqual({ ok: true, status: "rejected", reason: "unknown" });
    expect((await answer(old.token, "Berghain")).body).toMatchObject({ reason: "offprompt", canonical: { name: "Berghain" } });
    // Catalog-only entities (in no puzzle) are fine to name.
    expect((await answer(old.token, "Coachella")).body).toMatchObject({ reason: "offprompt", canonical: { name: "Coachella" } });
    const today = await started({ date: TODAY, index: 0, playerId: PLAYER_A });
    expect((await answer(today.token, "Glastonbury")).body).toMatchObject({ reason: "offprompt", canonical: { name: "Glastonbury" } });
  });
});
