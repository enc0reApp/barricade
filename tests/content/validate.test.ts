import { describe, expect, it } from "vitest";
import type { SourcePrompt } from "../../lib/content/types";
import { validatePrompt, validateSchedule, validateSource } from "../../lib/content/validate";
import { answer, prompt, schedule } from "./fixtures";

const file = (slug: string) => `content/source/prompts/${slug}.json`;
const messages = (issues: { severity: string; message: string }[], sev: "error" | "warning") =>
  issues.filter((i) => i.severity === sev).map((i) => i.message);

describe("validatePrompt — errors", () => {
  it("accepts a well-formed prompt with no errors or warnings", () => {
    const r = validatePrompt(prompt("ok"), file("ok"));
    expect(r.prompt).not.toBeNull();
    expect(r.issues).toEqual([]);
  });

  it("rejects non-objects and bad shapes/enums", () => {
    expect(validatePrompt([], file("x")).prompt).toBeNull();
    const bad = {
      ...prompt("bad"),
      types: ["festival", "planet"],
      difficulty: 7,
      rarity: "vibes",
      seconds: 2,
      boundary: "",
    };
    const r = validatePrompt(bad, file("bad"));
    const errs = messages(r.issues, "error").join("\n");
    expect(r.prompt).toBeNull();
    expect(errs).toMatch(/types: "planet"/);
    expect(errs).toMatch(/difficulty/);
    expect(errs).toMatch(/rarity/);
    expect(errs).toMatch(/seconds/);
    expect(errs).toMatch(/boundary/);
  });

  it("rejects bad answers: type, guess, flag, missing wiki, non-string aliases", () => {
    const p = prompt("ans");
    p.answers[0] = { ...p.answers[0]!, type: "planet" as never };
    p.answers[1] = { ...p.answers[1]!, guess: "huge" as never };
    p.answers[2] = { ...p.answers[2]!, flag: "gold" as never };
    const { wiki: _w, ...noWiki } = p.answers[3]!;
    p.answers[3] = noWiki as never;
    p.answers[4] = { ...p.answers[4]!, aliases: ["ok", 3 as never] };
    const errs = messages(validatePrompt(p, file("ans")).issues, "error").join("\n");
    expect(errs).toMatch(/answers\[0\].*type "planet"/);
    expect(errs).toMatch(/answers\[1\].*guess/);
    expect(errs).toMatch(/answers\[2\].*flag/);
    expect(errs).toMatch(/answers\[3\].*wiki: required/);
    expect(errs).toMatch(/answers\[4\].*aliases/);
  });

  it("errors when slug ≠ filename and on empty answers", () => {
    expect(messages(validatePrompt(prompt("one"), file("two")).issues, "error").join()).toMatch(/does not match file name "two.json"/);
    expect(messages(validatePrompt(prompt("e", { answers: [] }), file("e")).issues, "error")).toContain("answers: empty");
  });

  it("errors on duplicate answers by primary key", () => {
    const p = prompt("dup");
    p.answers.push(answer("Rock Werchter", "main"), answer("rock-werchter.", "side"));
    const errs = messages(validatePrompt(p, file("dup")).issues, "error");
    expect(errs.some((m) => m.includes("duplicate answer") && m.includes("rockwerchter"))).toBe(true);
  });

  it("errors when an alias maps to a different answer (name or alias)", () => {
    const p = prompt("col");
    p.answers.push(
      answer("Pukkelpop", "main", { aliases: ["PKP"] }),
      answer("Pinkpop", "main", { aliases: ["Pukkel Pop"] }), // collides with a name
      answer("Paaspop", "side", { aliases: ["pkp"] }), // collides with an alias
    );
    const errs = messages(validatePrompt(p, file("col")).issues, "error");
    expect(errs.some((m) => m.includes('alias "Pukkel Pop" of "Pinkpop" collides with name "Pukkelpop"'))).toBe(true);
    expect(errs.some((m) => m.includes('alias "pkp" of "Paaspop" collides with alias "PKP"'))).toBe(true);
  });
});

describe("validatePrompt — warnings", () => {
  it("warns on short lists, missing wiki, no main, too few rare, text and note style", () => {
    const p: SourcePrompt = {
      slug: "w",
      text: "Pick a festival with a very long prompt text that keeps going on and on and on forever",
      types: ["festival"],
      difficulty: 1,
      boundary: "x",
      sources: [],
      answers: [
        answer("A", "side"),
        answer("B", "side", { note: "x".repeat(91) }),
        answer("C", "tent"),
        answer("D", "side", { wiki: "D" }),
      ],
    };
    const warns = messages(validatePrompt(p, file("w")).issues, "warning").join("\n");
    expect(warns).toMatch(/only 4 answers/);
    expect(warns).toMatch(/3\/4 answers \(75%\) have no wiki/);
    expect(warns).toMatch(/no answer has guess "main"/);
    expect(warns).toMatch(/only 1 answers rarer than "side"/);
    expect(warns).toMatch(/should start with "Name"/);
    expect(warns).toMatch(/text is \d+ chars/);
    expect(warns).toMatch(/note is 91 chars/);
  });

  it("warns on aliases that add nothing and on answers sharing a wiki title", () => {
    const p = prompt("al");
    p.answers.push(
      answer("Bar 25", "tent", { aliases: ["Bar25", "Bar Twenty Five"], wiki: "Bar 25" }),
      answer("Kater Holzig", "tent", { wiki: "bar_25" }),
    );
    const warns = messages(validatePrompt(p, file("al")).issues, "warning").join("\n");
    expect(warns).toMatch(/alias "Bar25" adds nothing/);
    expect(warns).not.toMatch(/Bar Twenty Five/);
    expect(warns).toMatch(/"Kater Holzig" and "Bar 25" share the wiki title/);
  });

  it("warns on more than 2 tote flags and off-type answers", () => {
    const p = prompt("t");
    p.answers[5] = { ...p.answers[5]!, flag: "tote" };
    p.answers[6] = { ...p.answers[6]!, flag: "tote" };
    p.answers[7] = { ...p.answers[7]!, flag: "tote", type: "city" };
    const warns = messages(validatePrompt(p, file("t")).issues, "warning").join("\n");
    expect(warns).toMatch(/3 tote flags/);
    expect(warns).toMatch(/type "city" is not in the prompt's types/);
  });
});

describe("validateSchedule", () => {
  const types = ["festival", "city", "venue", "genre", "gear", "artist", "label"] as const;
  const seven = types.map((t, i) => prompt(`p${i + 1}`, { types: [t], difficulty: (Math.min(5, i + 1)) as 1 }, 30, t));
  const map = new Map(seven.map((p) => [p.slug, p]));
  const slugs = seven.map((p) => p.slug);

  it("accepts a good schedule", () => {
    const r = validateSchedule(schedule([slugs]), "schedule.json", map);
    expect(r.issues).toEqual([]);
    expect(r.schedule?.days).toHaveLength(1);
  });

  it("errors on wrong count, unknown slug, reuse, numbering and epoch", () => {
    const s = {
      epoch: "2026-02-30",
      days: [
        { number: 1, prompts: slugs.slice(0, 6) },
        { number: 3, prompts: [...slugs.slice(0, 6), "nope"] },
      ],
    };
    const errs = messages(validateSchedule(s, "schedule.json", map).issues, "error").join("\n");
    expect(errs).toMatch(/epoch/);
    expect(errs).toMatch(/day #1: has 6 prompts/);
    expect(errs).toMatch(/prompt "nope" does not exist/);
    expect(errs).toMatch(/prompt "p1" already used on day #1/);
    expect(errs).toMatch(/numbers must run 1, 2, 3/);
  });

  it("errors on a slug reused within one day", () => {
    const errs = messages(validateSchedule(schedule([[...slugs.slice(0, 6), "p1"]]), "s", map).issues, "error");
    expect(errs.some((m) => m.includes('"p1" already used earlier this day'))).toBe(true);
  });

  it("warns on type mix, artist overload and falling difficulty", () => {
    const art = Array.from({ length: 7 }, (_, i) =>
      prompt(`a${i}`, { types: ["artist"], difficulty: (i === 3 ? 1 : 3) as 1 }, 30, "artist"),
    );
    const m = new Map(art.map((p) => [p.slug, p]));
    const warns = messages(validateSchedule(schedule([art.map((p) => p.slug)]), "s", m).issues, "warning").join("\n");
    expect(warns).toMatch(/only 1 distinct primary types/);
    expect(warns).toMatch(/7 artist prompts/);
    expect(warns).toMatch(/difficulty drops from 3 \("a2"\) to 1 \("a3"\)/);
  });
});

describe("validateSource", () => {
  it("collects prompt and schedule issues and flags duplicate slugs", () => {
    const a = prompt("same");
    const r = validateSource({
      prompts: [
        { file: file("same"), data: a },
        { file: "content/source/prompts/sub/same.json", data: a },
      ],
      schedule: null,
    });
    const errs = r.errors.map((e) => e.message).join("\n");
    expect(errs).toMatch(/already used by/);
    expect(errs).toMatch(/schedule.json is missing/);
    expect(r.prompts).toHaveLength(1);
  });
});
