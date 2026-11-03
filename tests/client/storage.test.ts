import { describe, expect, it, vi } from "vitest";
import type { FinishResult, RoundPrompt } from "../../lib/api/contract";
import {
  PROOF_PAD_MS,
  STORAGE_KEY,
  applyStreak,
  createStore,
  compactGames,
  finishWaitMs,
  liveStreak,
  mergeGame,
  parseState,
  prevProof,
  progressOf,
  pushTry,
  receiptsOf,
  resumePoint,
  roundWaitMs,
  settleExpired,
  summaryFinish,
  tokensOf,
  withFlag,
  type KV,
  type StoredGame,
  type StoredRound,
  type Streak,
} from "../../lib/client/storage";
import { GRACE_MS } from "../../lib/game/tiers";

const prompt = (index: number): RoundPrompt => ({ index, total: 7, text: `Prompt ${index}`, types: ["festival"], seconds: 25 });

function round(index: number, extra: Partial<StoredRound> = {}): StoredRound {
  return { index, token: `tok${index}`, deadline: 100_000 + index, prompt: prompt(index), offset: 0, tries: [], ...extra };
}

function game(rounds: StoredRound[], extra: Partial<StoredGame> = {}): StoredGame {
  return { number: 12, date: "2026-11-09", mode: "today", status: "playing", total: 7, rounds, ...extra };
}

class MemKV implements KV {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

class ThrowingKV implements KV {
  getItem(): string | null {
    throw new Error("SecurityError");
  }
  setItem(): void {
    throw new Error("QuotaExceededError");
  }
}

const finish = (outcomes: FinishResult["outcomes"], mode: "today" | "archive" = "today"): FinishResult => ({
  ok: true,
  number: 12,
  date: "2026-11-09",
  mode,
  outcomes,
  distance: 700 - outcomes.length * 10,
  rounds: [],
  crowd: { plays: 10, beatPct: 50 },
});

describe("resume", () => {
  it("a game with no rounds resumes at the doors", () => {
    expect(resumePoint(game([]))).toEqual({ kind: "doors" });
    expect(resumePoint(null)).toEqual({ kind: "doors" });
  });

  it("mid-round before the deadline keeps the same token", () => {
    const g = game([round(0, { outcome: "main", receipt: "r0" }), round(1, { deadline: 50_000 })]);
    const settled = settleExpired(g, 40_000);
    expect(settled).toBe(g);
    expect(resumePoint(settled)).toEqual({ kind: "round", index: 1 });
    expect(settled.rounds[1]!.token).toBe("tok1");
  });

  it("mid-round after the deadline becomes a miss and resumes at its reveal", () => {
    const g = game([round(0, { outcome: "main", receipt: "r0" }), round(1, { deadline: 50_000 })]);
    const settled = settleExpired(g, 50_001);
    expect(settled.rounds[1]!.outcome).toBe("miss");
    expect(settled.rounds[1]!.receipt).toBeNull();
    expect(resumePoint(settled)).toEqual({ kind: "reveal", index: 1 });
  });

  it("uses the round's own clock offset when judging the deadline", () => {
    // Server is 2s ahead: at client 49_000 the server reads 51_000, past the deadline.
    const g = game([round(0, { deadline: 50_000, offset: 2_000 })]);
    expect(settleExpired(g, 49_000).rounds[0]!.outcome).toBe("miss");
    // Server 2s behind: client 51_000 is server 49_000, still open.
    const h = game([round(0, { deadline: 50_000, offset: -2_000 })]);
    expect(settleExpired(h, 51_000).rounds[0]!.outcome).toBeUndefined();
  });

  it("mid-reveal resumes at the reveal end state", () => {
    const g = game([round(0, { outcome: "basement", receipt: "r0" })]);
    expect(resumePoint(settleExpired(g, 10 ** 12))).toEqual({ kind: "reveal", index: 0 });
  });

  it("after the last round resumes at finishing, and a finished game shows the ticket", () => {
    const rounds = Array.from({ length: 7 }, (_, i) => round(i, { outcome: "side", receipt: `r${i}` }));
    expect(resumePoint(game(rounds))).toEqual({ kind: "finishing" });
    expect(resumePoint(game(rounds, { status: "finished", finish: finish(["side"]) }))).toEqual({ kind: "ticket" });
  });

  it("a compacted finished game never resumes at the doors (no replay over the record)", () => {
    const games: Record<string, StoredGame> = {};
    for (let d = 1; d <= 22; d++) {
      const date = `2026-10-${String(d).padStart(2, "0")}`;
      games[date] = game([round(0, { outcome: "miss", receipt: null })], { date, number: d, status: "finished", finish: finish(["miss"]) });
    }
    const oldest = compactGames(games)["2026-10-01"]!;
    expect(oldest.finish).toBeUndefined();
    expect(oldest.rounds).toEqual([]);
    expect(resumePoint(oldest)).toEqual({ kind: "summary" });
    // Its ticket is rebuilt from the summary, with no crowd numbers and no reveal.
    const t = summaryFinish(oldest)!;
    expect(t).toMatchObject({ ok: true, number: 1, date: "2026-10-01", mode: "today", outcomes: ["miss"], distance: 690, rounds: [] });
    expect(t.crowd).toEqual({ plays: null, beatPct: null });
    expect(summaryFinish(game([]))).toBeNull();
  });

  it("builds one receipt per round with nulls for misses", () => {
    const g = game([round(0, { outcome: "main", receipt: "a" }), round(1, { outcome: "miss", receipt: null }), round(2, { outcome: "tent", receipt: "c" })]);
    expect(receiptsOf(g)).toEqual(["a", null, "c", null, null, null, null]);
  });
});

describe("streak", () => {
  const empty: Streak = { current: 0, best: 0, lastDate: null };

  it("starts at 1 and grows on consecutive local dates", () => {
    let s = applyStreak(empty, "2026-11-09", "today");
    expect(s).toEqual({ current: 1, best: 1, lastDate: "2026-11-09" });
    s = applyStreak(s, "2026-11-10", "today");
    s = applyStreak(s, "2026-11-11", "today");
    expect(s).toEqual({ current: 3, best: 3, lastDate: "2026-11-11" });
  });

  it("restarts after a gap but keeps the best", () => {
    let s: Streak = { current: 4, best: 4, lastDate: "2026-11-09" };
    s = applyStreak(s, "2026-11-12", "today");
    expect(s).toEqual({ current: 1, best: 4, lastDate: "2026-11-12" });
  });

  it("never counts archive play or the same date twice", () => {
    const s = { current: 2, best: 5, lastDate: "2026-11-09" };
    expect(applyStreak(s, "2026-11-10", "archive")).toBe(s);
    expect(applyStreak(s, "2026-11-09", "today")).toBe(s);
    expect(applyStreak(s, "2026-11-01", "today")).toBe(s);
  });

  it("crosses month and year boundaries", () => {
    let s = applyStreak(empty, "2026-12-31", "today");
    s = applyStreak(s, "2027-01-01", "today");
    expect(s.current).toBe(2);
  });

  it("is alive today or the day after, then shows 0", () => {
    const s = { current: 3, best: 3, lastDate: "2026-11-09" };
    expect(liveStreak(s, "2026-11-09")).toBe(3);
    expect(liveStreak(s, "2026-11-10")).toBe(3);
    expect(liveStreak(s, "2026-11-11")).toBe(0);
    expect(liveStreak(empty, "2026-11-11")).toBe(0);
  });
});

describe("tries", () => {
  it("keeps the last five, moving repeats to the end", () => {
    let t: string[] = [];
    for (const x of ["a", "b", "c", "d", "e", "f"]) t = pushTry(t, x);
    expect(t).toEqual(["b", "c", "d", "e", "f"]);
    t = pushTry(t, "C");
    expect(t).toEqual(["b", "d", "e", "f", "C"]);
    expect(pushTry(t, "   ")).toEqual(t);
  });
});

describe("parse + store", () => {
  it("mints a valid playerId and persists it", () => {
    const kv = new MemKV();
    const store = createStore({ backend: kv });
    const id = store.playerId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(id.length).toBeGreaterThanOrEqual(16);
    expect(JSON.parse(kv.getItem(STORAGE_KEY)!).playerId).toBe(id);
    expect(createStore({ backend: kv }).playerId()).toBe(id);
  });

  it("survives garbage and old versions, keeping a valid playerId", () => {
    expect(parseState("{not json").version).toBe(1);
    const kept = parseState(JSON.stringify({ version: 0, playerId: "abcdefghijklmnop_-12" }));
    expect(kept.playerId).toBe("abcdefghijklmnop_-12");
    expect(kept.games).toEqual({});
    expect(parseState(JSON.stringify({ version: 1, playerId: "bad id!" })).playerId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("falls back to memory when storage throws", () => {
    const store = createStore({ backend: new ThrowingKV() });
    const id = store.playerId();
    store.putGame(game([round(0)]));
    expect(store.game("2026-11-09")?.rounds.length).toBe(1);
    expect(store.playerId()).toBe(id);
    expect(store.persistent()).toBe(false);
  });

  it("finishGame stores a summary and only today-mode finishes touch the streak", () => {
    const store = createStore({ backend: new MemKV() });
    const g = game([round(0, { outcome: "main", receipt: "r" })]);
    const { game: done, streak } = store.finishGame(g, finish(["main"]));
    expect(done.status).toBe("finished");
    expect(done.summary?.outcomes).toEqual(["main"]);
    expect(streak.current).toBe(1);

    const other = createStore({ backend: new MemKV() });
    const r = other.finishGame(game([], { mode: "archive", date: "2026-11-01" }), finish([], "archive"));
    expect(r.streak.current).toBe(0);
  });

  it("finishGame never overwrites a date that is already finished (the first finish is the record)", () => {
    const store = createStore({ backend: new MemKV() });
    const first = store.finishGame(game([round(0, { outcome: "miss", receipt: null })]), finish(["miss"]));
    const again = store.finishGame({ ...first.game, mode: "archive", status: "playing" }, finish(["main", "main"], "archive"));
    expect(again.game.summary).toEqual(first.game.summary);
    expect(again.game.mode).toBe("today");
    expect(store.game("2026-11-09")?.summary).toEqual({ outcomes: ["miss"], distance: 690 });
  });

  it("keeps per-game player ids and drops invalid ones", () => {
    const raw = JSON.stringify({
      version: 1,
      playerId: "abcdefghijklmnop_-12",
      games: {
        a: game([], { date: "2026-11-01", playerId: "game_player_0000000001" }),
        b: game([], { date: "2026-11-02", playerId: "bad id!" }),
      },
    });
    const st = parseState(raw);
    expect(st.games.a?.playerId).toBe("game_player_0000000001");
    expect(st.games.b).toBeUndefined();
    // A fallback id replaces a missing one instead of minting a new one.
    expect(parseState(null, "fallback_player_00001").playerId).toBe("fallback_player_00001");
    expect(parseState("{nope", "fallback_player_00001").playerId).toBe("fallback_player_00001");
  });

  it("compacts old finished games down to their summaries", () => {
    const games: Record<string, StoredGame> = {};
    for (let d = 1; d <= 25; d++) {
      const date = `2026-10-${String(d).padStart(2, "0")}`;
      games[date] = game([round(0, { outcome: "main" })], { date, status: "finished", finish: finish(["main"]) });
    }
    const out = compactGames(games, 21);
    expect(out["2026-10-25"]!.finish).toBeDefined();
    expect(out["2026-10-01"]!.finish).toBeUndefined();
    expect(out["2026-10-01"]!.summary).toEqual({ outcomes: ["main"], distance: 690 });
    expect(out["2026-10-01"]!.rounds).toEqual([]);
  });
});

describe("several tabs on one key", () => {
  const today = "2026-11-03";
  const archiveDate = "2026-10-27";

  it("a stale tab's write keeps the other tab's finished game and streak", () => {
    const kv = new MemKV();
    const a = createStore({ backend: kv });
    const b = createStore({ backend: kv });
    // Tab A boots on the archive and reads its (empty) state.
    a.streak();
    expect(a.game(archiveDate)).toBeNull();
    // Tab B finishes tonight's set.
    b.finishGame(game([round(0, { outcome: "main", receipt: "r" })], { date: today }), { ...finish(["main"]), date: today });
    // Tab A then plays a round of the archive set.
    a.putGame(game([round(0)], { date: archiveDate, mode: "archive", number: 5 }));

    const reload = createStore({ backend: kv });
    expect(reload.game(today)?.status).toBe("finished");
    expect(reload.game(archiveDate)?.rounds).toHaveLength(1);
    expect(reload.streak()).toEqual({ current: 1, best: 1, lastDate: today });
    expect(resumePoint(reload.game(today))).toEqual({ kind: "ticket" });
  });

  it("a stale playing copy never replaces a finished game, and the caller gets the stored one back", () => {
    const kv = new MemKV();
    const a = createStore({ backend: kv });
    const b = createStore({ backend: kv });
    a.read();
    const done = b.finishGame(game([round(0, { outcome: "main", receipt: "r" })], { date: today }), { ...finish(["main"]), date: today }).game;
    const back = a.putGame(game([round(0)], { date: today }));
    expect(back.status).toBe("finished");
    expect(back.summary).toEqual(done.summary);
    expect(createStore({ backend: kv }).game(today)?.status).toBe("finished");
  });

  it("a playing copy that is behind does not replace one that is further along", () => {
    const kv = new MemKV();
    const a = createStore({ backend: kv });
    const b = createStore({ backend: kv });
    b.putGame(game([round(0, { outcome: "main", receipt: "r0" }), round(1)], { date: today }));
    const back = a.putGame(game([], { date: today }));
    expect(back.rounds).toHaveLength(2);
    // Moving forward (or a same-progress edit like a rejected try) is fine.
    const tried = a.putGame(game([round(0, { outcome: "main", receipt: "r0" }), round(1, { tries: ["x"] })], { date: today }));
    expect(tried.rounds[1]?.tries).toEqual(["x"]);
  });

  it("adopts the id another tab stored, while each game keeps the id its receipts were issued to", () => {
    const kv = new MemKV();
    const a = createStore({ backend: kv });
    const idA = a.playerId();
    const g = a.putGame(game([round(0)], { date: today, playerId: idA }));
    // Another tab (in a race on an empty store) wrote a different top-level id.
    const raw = JSON.parse(kv.getItem(STORAGE_KEY)!);
    kv.setItem(STORAGE_KEY, JSON.stringify({ ...raw, playerId: "other_tab_player_00001" }));
    a.putGame({ ...g, rounds: [round(0, { outcome: "main", receipt: "r" })] });
    expect(a.playerId()).toBe("other_tab_player_00001");
    expect(a.game(today)?.playerId).toBe(idA);
  });

  it("drops its cache and tells subscribers when another tab writes", () => {
    const kv = new MemKV();
    const a = createStore({ backend: kv });
    const b = createStore({ backend: kv });
    expect(a.game(today)).toBeNull();
    b.putGame(game([round(0)], { date: today }));
    expect(a.game(today)).toBeNull(); // cached until told
    const cb = vi.fn();
    const off = a.subscribe(cb);
    a.externalChange();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(a.game(today)?.rounds).toHaveLength(1);
    off();
    a.externalChange();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("settings writes merge onto what storage holds now", () => {
    const kv = new MemKV();
    const a = createStore({ backend: kv });
    const b = createStore({ backend: kv });
    a.read();
    b.finishGame(game([], { date: today }), { ...finish([]), date: today });
    a.putSettings({ seenHow: true });
    const reload = createStore({ backend: kv });
    expect(reload.settings().seenHow).toBe(true);
    expect(reload.game(today)?.status).toBe("finished");
  });
});

describe("merging and flags", () => {
  it("orders progress: nothing < started < settled rounds < finished", () => {
    expect(progressOf(null)).toBe(-1);
    expect(progressOf(game([]))).toBe(0);
    expect(progressOf(game([round(0)]))).toBe(1);
    expect(progressOf(game([round(0, { outcome: "miss" })]))).toBe(2);
    expect(progressOf(game([round(0, { outcome: "miss" }), round(1)]))).toBe(3);
    expect(progressOf(game([], { status: "finished" }))).toBeGreaterThan(1000);
  });

  it("finished is terminal: only flags can grow", () => {
    const fin = game([round(0, { outcome: "main", receipt: "r" })], { status: "finished", finish: finish(["main"]), flagged: [1] });
    expect(mergeGame(fin, game([round(0)]))).toBe(fin);
    expect(mergeGame(fin, { ...fin, flagged: [1] })).toBe(fin);
    expect(mergeGame(fin, { ...fin, flagged: [4] }).flagged).toEqual([1, 4]);
    expect(mergeGame(game([round(0)]), fin)).toBe(fin);
  });

  it("two flags sent from the same snapshot both stick", () => {
    const kv = new MemKV();
    const store = createStore({ backend: kv });
    const g = game([round(2, { outcome: "miss", receipt: null })], { status: "finished", finish: finish(["miss"]) });
    store.putGame(g);
    // Both requests captured `g` (flagged: []) before either returned.
    store.putGame(withFlag(g, 2));
    store.putGame(withFlag(g, 5));
    expect(createStore({ backend: kv }).game(g.date)?.flagged).toEqual([2, 5]);
  });
});

describe("proof of play", () => {
  const T = 1_000_000;
  // Round clocks: deadline in server time, offset = server − client.
  const missed = (index: number, deadline: number, offset = 0) => round(index, { deadline, offset, outcome: "miss", receipt: null });
  const answered = (index: number, deadline: number) => round(index, { deadline, outcome: "main", receipt: `rc${index}` });

  it("sends one token per round, in order", () => {
    const g = game([answered(0, T), missed(1, T), answered(2, T)]);
    expect(tokensOf(g)).toEqual(["tok0", "tok1", "tok2", "", "", "", ""]);
  });

  it("starts each later round with the previous round's token and receipt", () => {
    const g = game([answered(0, T), missed(1, T)]);
    expect(prevProof(g, 0)).toEqual({});
    expect(prevProof(g, 1)).toEqual({ prevToken: "tok0", prevReceipt: "rc0" });
    expect(prevProof(g, 2)).toEqual({ prevToken: "tok1", prevReceipt: null });
  });

  it("after a miss, waits out the missed round's deadline + grace on the server clock", () => {
    const g = game([answered(0, T), missed(1, T + 25_000, 2_000)]);
    expect(roundWaitMs(g, 0, T)).toBe(0);
    expect(roundWaitMs(g, 1, T)).toBe(0); // round 0 was answered
    // Server is 2s ahead: its deadline T+25s is client T+23s.
    expect(roundWaitMs(g, 2, T + 23_000)).toBe(GRACE_MS + PROOF_PAD_MS);
    expect(roundWaitMs(g, 2, T + 23_000 + GRACE_MS)).toBe(PROOF_PAD_MS);
    expect(roundWaitMs(g, 2, T + 60_000)).toBe(0);
  });

  it("finishes only after every missed round is past its deadline + grace", () => {
    const allAnswered = game(Array.from({ length: 7 }, (_, i) => answered(i, T + i)));
    expect(finishWaitMs(allAnswered, T)).toBe(0);
    const lastMissed = game([...Array.from({ length: 6 }, (_, i) => answered(i, T)), missed(6, T + 50_000, -1_000)]);
    // Server 1s behind: its T+50s is client T+51s.
    expect(finishWaitMs(lastMissed, T + 51_000)).toBe(GRACE_MS + PROOF_PAD_MS);
    expect(finishWaitMs(lastMissed, T + 51_000 + GRACE_MS + PROOF_PAD_MS)).toBe(0);
  });
});
