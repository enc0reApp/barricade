import { describe, expect, it } from "vitest";
import type { FinishResult, RoundPrompt } from "../../lib/api/contract";
import {
  STORAGE_KEY,
  applyStreak,
  createStore,
  compactGames,
  liveStreak,
  parseState,
  pushTry,
  receiptsOf,
  resumePoint,
  settleExpired,
  type KV,
  type StoredGame,
  type StoredRound,
  type Streak,
} from "../../lib/client/storage";

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
