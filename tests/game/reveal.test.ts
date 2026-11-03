import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validatePack } from "../../lib/content/loader";
import type { PackPrompt } from "../../lib/content/types";
import { buildReveal, revealPicks } from "../../lib/game/reveal";
import { toAccepted } from "../../lib/game/rules";
import { TIER_IDS } from "../../lib/game/tiers";

const FIXTURE = fileURLToPath(new URL("../fixtures/pack.json", import.meta.url));
const pack = validatePack(JSON.parse(readFileSync(FIXTURE, "utf8")));
const puzzle1 = pack.puzzles[0]!;
const uk = puzzle1.prompts[0]!;

describe("revealPicks", () => {
  it("spreads picks across tiers, main → htbt, excluding the player's answer", () => {
    const picks = revealPicks(uk, "festival:glastonbury");
    expect(picks.map((p) => p.name)).toEqual([
      // main ≤3, highest share first (Glastonbury excluded)
      "Reading Festival",
      "Leeds Festival",
      "Download Festival",
      // tote ≤2
      "Boomtown",
      // side 2 by share
      "Creamfields",
      "Field Day",
      // tent 2: note first
      "Green Man",
      "Bestival",
      // basement 2: note first
      "Houghton",
      "Lovebox",
      // htbt 3: note first, then share
      "Field Maneuvers",
      "Freerotation",
      "Gottwood",
    ]);
    const order = picks.map((p) => TIER_IDS.indexOf(p.tier));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("caps each tier", () => {
    const counts = new Map<string, number>();
    for (const p of revealPicks(uk, null)) counts.set(p.tier, (counts.get(p.tier) ?? 0) + 1);
    expect(Object.fromEntries(counts)).toEqual({ main: 3, tote: 1, side: 2, tent: 2, basement: 2, htbt: 3 });
  });

  it("prefers answers with a note in the deep tiers even over a higher share", () => {
    const p: PackPrompt = {
      id: "t",
      text: "Name a thing",
      types: ["other"],
      difficulty: 1,
      seconds: 25,
      answers: [
        { id: "other:a", name: "A", type: "other", tier: "htbt", share: 0.0009, keys: ["aa"] },
        { id: "other:b", name: "B", type: "other", tier: "htbt", share: 0.0001, keys: ["bb"], note: "fact" },
        { id: "other:c", name: "C", type: "other", tier: "main", share: 0.1, keys: ["cc"] },
        { id: "other:d", name: "D", type: "other", tier: "main", share: 0.3, keys: ["dd"], note: "fact" },
        { id: "other:e", name: "E", type: "other", tier: "htbt", share: 0.0009, keys: ["ee"] },
      ],
    };
    // main: share only (D then C). htbt: note first (B), then share, ties by id (A before E).
    expect(revealPicks(p, null).map((x) => x.name)).toEqual(["D", "C", "B", "A", "E"]);
  });

  it("only carries a note when the answer has one", () => {
    const picks = revealPicks(uk, null);
    expect(picks.find((p) => p.name === "Green Man")?.note).toBeTruthy();
    expect("note" in picks.find((p) => p.name === "Bestival")!).toBe(false);
  });
});

describe("buildReveal", () => {
  it("builds one round per prompt with yours, picks and totals", () => {
    const glasto = uk.answers.find((a) => a.id === "festival:glastonbury")!;
    const rounds = buildReveal(puzzle1.prompts, [{ answer: toAccepted(glasto), crowdPct: 41.5 }, null]);
    expect(rounds).toHaveLength(7);
    const [r0, r1] = rounds as [(typeof rounds)[number], (typeof rounds)[number]];
    expect(r0.index).toBe(0);
    expect(r0.text).toBe(uk.text);
    expect(r0.hint).toBe("Past or present.");
    expect(r0.total).toBe(uk.answers.length);
    expect(r0.yours).toEqual({ ...toAccepted(glasto), crowdPct: 41.5 });
    expect(r0.yours?.points).toBe(10);
    expect(r0.picks.some((p) => p.name === "Glastonbury")).toBe(false);
    expect(r1.yours).toBeNull();
    expect("hint" in r1).toBe(false);
    expect(r1.picks.some((p) => p.name === "Berghain")).toBe(true);
  });

  it("is deterministic", () => {
    const a = JSON.stringify(buildReveal(puzzle1.prompts, []));
    const b = JSON.stringify(buildReveal(puzzle1.prompts, []));
    expect(a).toBe(b);
  });
});
