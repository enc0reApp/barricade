import { describe, expect, it } from "vitest";
import { noSetMeta } from "../../lib/client/api";
import { createMockApi } from "../../lib/client/mock";
import { addDays, localDateString } from "../../lib/game/day";

const PLAYER = "test_player_000000001";

describe("mock api", () => {
  const api = createMockApi("on");
  const today = localDateString();

  it("serves today's set as #12 in today mode", async () => {
    const set = await api.getSet(today);
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.number).toBe(12);
    expect(set.mode).toBe("today");
    expect(set.rounds).toBe(7);
    expect(set.latestNumber).toBe(12);
  });

  it("refuses dates before the epoch, but still says where the archive is", async () => {
    const r = await api.getSet(addDays(today, -40));
    expect(r).toMatchObject({ ok: false, error: "no-set" });
    expect(noSetMeta(r)).toEqual({ epoch: addDays(today, -11), latestNumber: 12 });
  });

  it("closed flavour: no set tonight, the archive runs to last night", async () => {
    const closed = createMockApi("closed");
    const r = await closed.getSet(today);
    expect(noSetMeta(r)).toEqual({ epoch: addDays(today, -11), latestNumber: 11 });
  });

  it("accepts (and ignores) proof of play on rounds and finishes", async () => {
    const r0 = await api.startRound({ date: today, index: 0, playerId: PLAYER });
    if (!r0.ok) throw new Error("round 0");
    const r1 = await api.startRound({ date: today, index: 1, playerId: PLAYER, prevToken: r0.token, prevReceipt: null });
    expect(r1.ok).toBe(true);
    const fin = await api.finish({ date: today, playerId: PLAYER, receipts: Array(7).fill(null), tokens: Array(7).fill(r0.token) });
    expect(fin.ok).toBe(true);
  });

  it("plays a round: rejects, says off-prompt, accepts with fuzzy matching, then finishes", async () => {
    const started = await api.startRound({ date: today, index: 0, playerId: PLAYER });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.deadline - started.serverNow).toBeLessThanOrEqual(25_000);
    expect(started.prompt.text).toMatch(/^Name/);

    const nope = await api.answer({ token: started.token, text: "banana" });
    expect(nope).toMatchObject({ ok: true, status: "rejected", reason: "unknown" });

    const off = await api.answer({ token: started.token, text: "berghain" });
    expect(off).toMatchObject({ ok: true, status: "rejected", reason: "offprompt", canonical: { name: "Berghain" } });

    const yes = await api.answer({ token: started.token, text: "glastonbery" });
    expect(yes.ok && yes.status === "accepted" && yes.answer.name).toBe("Glastonbury");
    if (!(yes.ok && yes.status === "accepted")) return;

    const fin = await api.finish({ date: today, playerId: PLAYER, receipts: [yes.receipt, null, null, null, null, null, null] });
    expect(fin.ok).toBe(true);
    if (!fin.ok) return;
    expect(fin.outcomes).toEqual(["main", "miss", "miss", "miss", "miss", "miss", "miss"]);
    expect(fin.distance).toBe(690);
    expect(fin.rounds[0]!.yours?.name).toBe("Glastonbury");
    expect(fin.rounds[0]!.picks.some((p) => p.name === "Glastonbury")).toBe(false);
  }, 10_000);

  it("keeps studio and gear trivia out of both demo sets", async () => {
    for (const date of [today, addDays(today, -1)]) {
      for (let index = 0; index < 7; index++) {
        const round = await api.startRound({ date, index, playerId: PLAYER });
        if (!round.ok) throw new Error(round.error);
        expect(round.prompt.types).not.toContain("gear");
        expect(round.prompt.text).not.toMatch(/drum machine|synthesizer|recording studio|pro-audio/i);
      }
    }
  });

  it("keeps the crowd page shut until the date has closed everywhere", async () => {
    const r = await api.crowd(today);
    expect(r).toMatchObject({ ok: false, error: "not-yet" });
    expect(typeof (r as { serverNow?: unknown }).serverNow).toBe("number");
    const old = await api.crowd(addDays(today, -3));
    expect(old.ok).toBe(true);
    if (old.ok) expect(old.distribution).toHaveLength(15);
  });
});
