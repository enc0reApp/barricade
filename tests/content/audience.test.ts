import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { audienceIssues } from "../../lib/content/audience";
import type { ContentPack } from "../../lib/content/types";
import { prompt, schedule } from "./fixtures";

it("rejects studio and equipment trivia in playable schedules", () => {
  const texts = ["Name a drum machine", "Name a synthesizer", "Name a famous recording studio", "Name a DAW or DJ app", "Name a loudspeaker brand you'd see at a festival", "Name a brand that makes DJ equipment"];
  for (const text of texts) {
    const p = prompt("studio", { text });
    expect(audienceIssues([p], schedule([[p.slug]]))).toHaveLength(1);
  }
  const gear = prompt("gear", { text: "Name a brand", types: ["gear"] });
  expect(audienceIssues([gear], schedule([[gear.slug]]))).toHaveLength(1);
});

it("keeps live sound-system crews, genres, venues and lineups in scope", () => {
  for (const text of ["Name a Notting Hill Carnival sound system", "Name a drum & bass festival", "Name a music venue", "Name an act that headlined Coachella"]) {
    const p = prompt("live", { text });
    expect(audienceIssues([p], schedule([[p.slug]]))).toEqual([]);
  }
});

it("does not block retained historical source data outside the schedule", () => {
  expect(audienceIssues([prompt("old", { types: ["gear"] })], schedule([["live"]]))).toEqual([]);
});

describe("the shipped public sample", () => {
  const pack = JSON.parse(readFileSync(new URL("../../content/sample/pack.json", import.meta.url), "utf8")) as ContentPack;
  it("starts with a show and contains no studio or gear questions", () => {
    expect(pack.puzzles[0]!.prompts[0]!.text).toBe("Name an act that played Woodstock in 1969");
    for (const p of pack.puzzles.flatMap((s) => s.prompts)) {
      expect(p.types).not.toContain("gear");
      expect(p.text).not.toMatch(/drum machine|synthesizer|recording studio|loudspeaker brand/i);
    }
  });
});
