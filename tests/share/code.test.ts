import { describe, expect, it } from "vitest";
import { MISS, ROUNDS_PER_SET, START_DISTANCE, TIERS, TIER_IDS, type Outcome } from "../../lib/game/tiers";
import { decodeShareCode, distanceLine, encodeShareCode, shareText } from "../../lib/share/code";

const ALL: Outcome[] = [...TIER_IDS, "miss"];

describe("share codes", () => {
  it("round-trips every outcome in every slot", () => {
    for (const o of ALL) {
      for (let slot = 0; slot < ROUNDS_PER_SET; slot++) {
        const outcomes: Outcome[] = Array.from({ length: ROUNDS_PER_SET }, (_, i) => (i === slot ? o : "main"));
        const code = encodeShareCode(42, outcomes);
        const back = decodeShareCode(code);
        expect(back).not.toBeNull();
        expect(back!.number).toBe(42);
        expect(back!.outcomes).toEqual(outcomes);
      }
    }
  });

  it("round-trips pseudo-random sets", () => {
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let k = 0; k < 200; k++) {
      const outcomes = Array.from({ length: ROUNDS_PER_SET }, () => ALL[Math.floor(next() * ALL.length)]!);
      const n = 1 + Math.floor(next() * 99999);
      expect(decodeShareCode(encodeShareCode(n, outcomes))).toEqual({
        number: n,
        outcomes,
        distance: Math.max(0, START_DISTANCE - outcomes.reduce((s, o) => s + (o === "miss" ? 0 : TIERS[o].points), 0)),
      });
    }
  });

  it("derives the distance from the outcomes", () => {
    expect(decodeShareCode("12-hbxnbbs")?.distance).toBe(255); // 100+85+0+60+85+85+30 = 445
    expect(decodeShareCode("3-mmxtssm")?.distance).toBe(595);
    expect(decodeShareCode("9-hhhhhhh")?.distance).toBe(0);
    expect(decodeShareCode("1-xxxxxxx")?.distance).toBe(START_DISTANCE);
  });

  it("uses one distinct letter per outcome", () => {
    const letters = ALL.map((o) => (o === "miss" ? MISS.code : TIERS[o].code));
    expect(new Set(letters).size).toBe(ALL.length);
    expect(letters.every((l) => /^[a-z]$/.test(l))).toBe(true);
  });

  it("accepts case and surrounding whitespace", () => {
    expect(decodeShareCode(" 12-HBXNBBS\n")).toEqual(decodeShareCode("12-hbxnbbs"));
  });

  it.each([
    "",
    " ",
    "12",
    "12-",
    "-hbxnbbs",
    "abc",
    "12-hbxnbb", // 6 rounds
    "12-hbxnbbss", // 8 rounds
    "12-hbxnbbz", // unknown letter
    "12-hbxnbb1",
    "0-hbxnbbs", // set numbers start at 1
    "-1-hbxnbbs",
    "123456-hbxnbbs", // > 5 digits
    "1.5-hbxnbbs",
    "12_hbxnbbs",
    "12-hbx nbbs",
    "12-hbxnbbs-14",
    "12-hbxnbbs/../x",
    "12-hbxñbbs",
  ])("rejects %j", (code) => {
    expect(decodeShareCode(code)).toBeNull();
  });

  it("formats the distance line", () => {
    expect(distanceLine(0)).toBe("ON THE BARRICADE");
    expect(distanceLine(14)).toBe("14m from the stage");
  });

  it("builds spoiler-free share text with a bare host", () => {
    const outcomes = decodeShareCode("12-hbxnbbs")!.outcomes;
    expect(shareText(12, outcomes, "https://fstvl.xyz/")).toBe(
      ["BARRICADE #12 🎟️", "255m from the stage", "🟨🟪⬛🟩🟪🟪🟦", "fstvl.xyz/s/12-hbxnbbs"].join("\n"),
    );
  });
});
