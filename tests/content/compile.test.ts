import { describe, expect, it } from "vitest";
import {
  SHARE_TOTAL,
  clampShareToTier,
  compile,
  slugifyName,
  tierForShare,
  type CompileInput,
} from "../../lib/content/compile";
import type { PackPrompt, SourcePrompt } from "../../lib/content/types";
import { NORMALIZE_VERSION, matchKeys } from "../../lib/game/normalize";
import { DEFAULT_SECONDS, SHARE_THRESHOLDS } from "../../lib/game/tiers";
import { answer, fameCache, prompt, schedule } from "./fixtures";

const T = SHARE_THRESHOLDS;

function build(prompts: SourcePrompt[], extra: Partial<CompileInput> = {}, days?: string[][]) {
  return compile({
    prompts,
    schedule: schedule(days ?? [prompts.map((p) => p.slug)]),
    fame: null,
    kind: "sample",
    generatedAt: "2026-11-02T00:00:00.000Z",
    ...extra,
  });
}

function promptOf(r: ReturnType<typeof build>, slug: string): PackPrompt {
  for (const pz of r.pack.puzzles) for (const p of pz.prompts) if (p.id === slug) return p;
  throw new Error(`no prompt ${slug}`);
}
const byName = (p: PackPrompt, name: string) => {
  const a = p.answers.find((x) => x.name === name);
  if (!a) throw new Error(`no answer ${name}`);
  return a;
};

describe("helpers", () => {
  it("maps shares to tiers at the thresholds", () => {
    expect(tierForShare(T.main)).toBe("main");
    expect(tierForShare(T.main - 1e-9)).toBe("side");
    expect(tierForShare(T.side)).toBe("side");
    expect(tierForShare(T.tent)).toBe("tent");
    expect(tierForShare(T.basement)).toBe("basement");
    expect(tierForShare(T.basement - 1e-9)).toBe("htbt");
  });
  it("clamps shares into a tier band", () => {
    expect(tierForShare(clampShareToTier(0.5, "htbt"))).toBe("htbt");
    expect(tierForShare(clampShareToTier(0.00001, "main"))).toBe("main");
    expect(tierForShare(clampShareToTier(0.5, "tent"))).toBe("tent");
    expect(clampShareToTier(0.3, "tote")).toBe(0.3);
  });
  it("slugifies names", () => {
    expect(slugifyName("Fred again..")).toBe("fred-again");
    expect(slugifyName("Salon zur Wilden Renate")).toBe("salon-zur-wilden-renate");
    expect(slugifyName("Björk & Friends")).toBe("bjork-and-friends");
  });
});

describe("pack shape", () => {
  it("fills pack metadata, dates, seconds and sorts answers by share", () => {
    const a = prompt("alpha", { hint: "Any era.", seconds: 30 });
    const b = prompt("beta");
    const r = build([a, b], {}, [["alpha"], ["beta"]]);
    expect(r.pack.format).toBe(1);
    expect(r.pack.kind).toBe("sample");
    expect(r.pack.normalizeVersion).toBe(NORMALIZE_VERSION);
    expect(r.pack.epoch).toBe("2026-01-01");
    expect(r.pack.puzzles.map((p) => [p.number, p.date])).toEqual([
      [1, "2026-01-01"],
      [2, "2026-01-02"],
    ]);
    const pa = promptOf(r, "alpha");
    expect(pa.seconds).toBe(30);
    expect(pa.hint).toBe("Any era.");
    expect(promptOf(r, "beta").seconds).toBe(DEFAULT_SECONDS);
    expect(promptOf(r, "beta").hint).toBeUndefined();
    const shares = pa.answers.map((x) => x.share);
    expect([...shares].sort((x, y) => y - x)).toEqual(shares);
    const total = shares.reduce((s, x) => s + x, 0);
    expect(total).toBeGreaterThan(SHARE_TOTAL - 0.02);
    expect(total).toBeLessThan(SHARE_TOTAL + 0.05);
  });

  it("uses epochOverride and keeps schedule order and titles", () => {
    const ps = ["c", "a", "b"].map((s) => prompt(s));
    const r = compile({
      prompts: ps,
      schedule: { epoch: "2026-01-01", days: [{ number: 1, title: "OPENER", prompts: ["c", "a", "b"] }] },
      fame: null,
      kind: "production",
      generatedAt: "x",
      epochOverride: "2026-11-09",
    });
    expect(r.pack.epoch).toBe("2026-11-09");
    expect(r.pack.puzzles[0]!.date).toBe("2026-11-09");
    expect(r.pack.puzzles[0]!.title).toBe("OPENER");
    expect(r.pack.puzzles[0]!.prompts.map((p) => p.id)).toEqual(["c", "a", "b"]);
    expect(r.report.days[0]!.summary).toContain('#1 2026-11-09 "OPENER"');
  });

  it("rejects a bad epoch and unknown scheduled slugs", () => {
    expect(() => build([prompt("a")], { epochOverride: "2026-13-01" })).toThrow(/epoch/);
    expect(() => build([prompt("a")], {}, [["a", "zzz"]])).toThrow(/unknown prompt "zzz"/);
  });

  it("only puts scheduled prompts into puzzles but catalogs every prompt", () => {
    const sched = prompt("sched");
    const extra = prompt("extra");
    extra.answers.push(answer("Unscheduled Fest", "side", { wiki: "Unscheduled Fest" }));
    const r = build([sched, extra], {}, [["sched"]]);
    expect(r.pack.puzzles.flatMap((p) => p.prompts.map((x) => x.id))).toEqual(["sched"]);
    expect(r.pack.catalog.some((e) => e.name === "Unscheduled Fest")).toBe(true);
    expect(r.report.prompts.find((p) => p.slug === "extra")!.days).toEqual([]);
  });
});

describe("entities", () => {
  it("merges by canonical wiki title (case-insensitive, via redirects) and by type + name", () => {
    const a = prompt("a");
    const b = prompt("b");
    a.answers.push(answer("Rock Werchter", "main", { wiki: "Rock_Werchter" }));
    b.answers.push(answer("Werchter", "side", { wiki: "rock werchter" })); // same article, different name
    a.answers.push(answer("Dour", "side", { wiki: "Dour Festival" }));
    b.answers.push(answer("Dour Music Festival", "side", { wiki: "Dour (festival)" })); // redirect → same canonical
    a.answers.push(answer("Pinkpop", "main"));
    b.answers.push(answer("PINKPOP", "main", { wiki: "Pinkpop Festival" })); // name match, one side has no wiki
    const fame = fameCache({
      "Rock Werchter": { views: 100 },
      "Dour Festival": { views: 50 },
      "Dour (festival)": { views: 50, canonical: "Dour Festival" },
      "Pinkpop Festival": { views: 70 },
    });
    const r = build([a, b], { fame });
    const pa = promptOf(r, "a");
    const pb = promptOf(r, "b");
    expect(byName(pb, "Werchter").id).toBe(byName(pa, "Rock Werchter").id);
    expect(byName(pb, "Dour Music Festival").id).toBe(byName(pa, "Dour").id);
    expect(byName(pb, "PINKPOP").id).toBe(byName(pa, "Pinkpop").id);
    const entry = r.pack.catalog.find((e) => e.id === byName(pa, "Rock Werchter").id)!;
    expect(entry.name).toBe("Rock Werchter");
    // Catalog keys are the union of every name/alias used anywhere.
    expect(entry.keys).toEqual(expect.arrayContaining(["rockwerchter", "werchter"]));
    expect(r.report.totals.mergedEntities).toBeGreaterThanOrEqual(3);
  });

  it("keeps same-name entities apart when types or articles differ, with numeric id suffixes", () => {
    const a = prompt("a");
    const b = prompt("b");
    a.answers.push(answer("Paradise", "tent", { type: "venue", wiki: "Paradise Garage" }));
    b.answers.push(answer("Paradise", "tent", { type: "venue", wiki: "Paradiso (Amsterdam)" }));
    b.answers.push(answer("Paradise", "tent", { type: "festival", wiki: null }));
    const r = build([a, b]);
    const ids = [byName(promptOf(r, "a"), "Paradise").id, ...promptOf(r, "b").answers.filter((x) => x.name === "Paradise").map((x) => x.id)];
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual(expect.arrayContaining(["venue:paradise", "venue:paradise-2", "festival:paradise"]));
    expect(r.report.idCollisions).toEqual([{ id: "venue:paradise-2", name: "Paradise", base: "venue:paradise" }]);
  });
});

describe("entities within one prompt", () => {
  it("never merges two answers of the same prompt, even when their articles redirect to one", () => {
    const p = prompt("gear", {}, 0);
    p.answers = [
      answer("Roland TR-707", "tent", { type: "gear", wiki: "Roland TR-707" }),
      answer("Roland TR-727", "basement", { type: "gear", wiki: "Roland TR-727" }), // redirects to TR-707
    ];
    const fame = fameCache({
      "Roland TR-707": { views: 900 },
      "Roland TR-727": { views: 900, canonical: "Roland TR-707" },
    });
    const pr = promptOf(build([p], { fame }), "gear");
    expect(byName(pr, "Roland TR-707").id).toBe("gear:roland-tr-707");
    expect(byName(pr, "Roland TR-727").id).toBe("gear:roland-tr-727");
  });
});

describe("answer keys", () => {
  it("drops keys shared inside a prompt except where they are an answer's own name key", () => {
    const p = prompt("k");
    p.answers.push(
      answer("Lowlands", "main", { aliases: ["A Campingflight to Lowlands Paradise", "LL"] }),
      answer("Lokerse Feesten", "side", { aliases: ["LL"] }),
      answer("Best Kept Secret", "side", { aliases: ["BKS"] }),
      answer("BKS", "htbt"), // name key "bks" — kept here, dropped from Best Kept Secret
    );
    const r = build([p]);
    const pk = promptOf(r, "k");
    expect(byName(pk, "Lowlands").keys).not.toContain("ll");
    expect(byName(pk, "Lokerse Feesten").keys).not.toContain("ll");
    expect(byName(pk, "Lowlands").keys).toEqual(expect.arrayContaining(["lowlands", "acampingflighttolowlandsparadise"]));
    expect(byName(pk, "BKS").keys).toContain("bks");
    expect(byName(pk, "Best Kept Secret").keys).not.toContain("bks");
    const dropped = r.report.prompts[0]!.droppedKeys;
    expect(dropped).toEqual(
      expect.arrayContaining([
        { key: "ll", droppedFrom: ["Lowlands", "Lokerse Feesten"], keptBy: [] },
        { key: "bks", droppedFrom: ["Best Kept Secret"], keptBy: ["BKS"] },
      ]),
    );
  });

  it("stores every matchKey of name and aliases", () => {
    const p = prompt("m");
    p.answers.push(answer("Drum and Bass Arena", "tent", { aliases: ["DnB Arena"] }));
    const a = byName(promptOf(build([p]), "m"), "Drum and Bass Arena");
    for (const k of [...matchKeys("Drum and Bass Arena"), ...matchKeys("DnB Arena")]) expect(a.keys).toContain(k);
  });
});

describe("rarity", () => {
  /** 13 answers so the htbt guarantee applies; views descend. */
  function fameFixture(rarity: SourcePrompt["rarity"], guesses?: SourcePrompt["answers"][number]["guess"][]) {
    const names = "ABCDEFGHIJKLM".split("");
    const views = [100000, 40000, 20000, 9000, 5000, 3000, 1500, 800, 400, 200, 100, 50, 10];
    const g = guesses ?? (["tent", "tent", "tent", "tent", "tent", "tent", "tent", "tent", "tent", "tent", "tent", "tent", "tent"] as const);
    const p: SourcePrompt = {
      slug: "r",
      text: "Name a thing",
      types: ["city"],
      difficulty: 1,
      boundary: "x",
      sources: [],
      rarity,
      answers: names.map((n, i) => ({ name: `City ${n}`, type: "city", wiki: `City ${n}`, guess: g[i]! })),
    };
    const fame = fameCache(Object.fromEntries(names.map((n, i) => [`City ${n}`, { views: views[i]! }])));
    return { p, fame };
  }

  it("'fame' follows pageviews^α regardless of guesses", () => {
    const { p, fame } = fameFixture("fame");
    const pr = promptOf(build([p], { fame }), "r");
    expect(pr.answers.map((a) => a.name)).toEqual("ABCDEFGHIJKLM".split("").map((n) => `City ${n}`));
    const A = byName(pr, "City A").share;
    const B = byName(pr, "City B").share;
    expect(A / B).toBeCloseTo((100000 / 40000) ** 1.1, 2);
    expect(byName(pr, "City A").tier).toBe("main");
    expect(byName(pr, "City M").tier).toBe("htbt");
  });

  it("'guess' ignores fame entirely", () => {
    const guesses = ["htbt", "tent", "tent", "tent", "tent", "tent", "tent", "tent", "tent", "tent", "tent", "tent", "main"] as const;
    const { p, fame } = fameFixture("guess", [...guesses]);
    const pr = promptOf(build([p], { fame }), "r");
    expect(pr.answers[0]!.name).toBe("City M");
    expect(byName(pr, "City M").tier).toBe("main");
    expect(byName(pr, "City A").tier).toBe("htbt");
    // All "tent" guesses share one value.
    expect(new Set(pr.answers.filter((a) => a.name !== "City M" && a.name !== "City A").map((a) => a.share)).size).toBe(1);
  });

  it("'blend' (default) is the geometric mean of fame and guess shares", () => {
    const guesses = ["tent", "main", "tent", "tent", "tent", "tent", "tent", "tent", "tent", "tent", "tent", "tent", "tent"] as const;
    const { p, fame } = fameFixture(undefined, [...guesses]);
    const r = build([p], { fame });
    const pr = promptOf(r, "r");
    const A = byName(pr, "City A").share;
    const B = byName(pr, "City B").share;
    // fame ratio (2.5^1.1) × guess ratio (0.008/0.12), square-rooted.
    expect(A / B).toBeCloseTo(Math.sqrt((100000 / 40000) ** 1.1 * (0.008 / 0.12)), 2);
    expect(r.report.prompts[0]!.rarity).toBe("blend");
  });

  it("answers without fame fall back to their guess share", () => {
    const p = prompt("nf", { rarity: "fame" }, 0);
    p.answers = [
      answer("Famous", "tent", { wiki: "Famous" }),
      answer("Unknown Main", "main"),
      answer("Unknown Htbt", "htbt"),
    ];
    const fame = fameCache({ Famous: { views: 1000 } });
    const pr = promptOf(build([p], { fame }), "nf");
    // Raw: Famous gets the guess mass of the famed set (0.008); others their guesses.
    const total = 0.008 + 0.12 + 0.0004;
    expect(byName(pr, "Unknown Main").share).toBeCloseTo((0.12 / total) * SHARE_TOTAL, 3);
    expect(byName(pr, "Famous").share).toBeCloseTo((0.008 / total) * SHARE_TOTAL, 4);
  });

  it("flags override: tote, htbt, lock (lock also ignores fame)", () => {
    const { p, fame } = fameFixture("fame");
    p.answers[1] = { ...p.answers[1]!, flag: "tote" };
    p.answers[2] = { ...p.answers[2]!, flag: "htbt" };
    p.answers[12] = { ...p.answers[12]!, flag: "lock", guess: "side" };
    const r = build([p], { fame });
    const pr = promptOf(r, "r");
    expect(byName(pr, "City B").tier).toBe("tote");
    expect(byName(pr, "City C").tier).toBe("htbt");
    expect(byName(pr, "City C").share).toBeLessThan(T.basement);
    expect(byName(pr, "City M").tier).toBe("side");
    expect(tierForShare(byName(pr, "City M").share)).toBe("side");
    expect(r.report.prompts[0]!.flags).toEqual([
      { name: "City B", flag: "tote" },
      { name: "City C", flag: "htbt" },
      { name: "City M", flag: "lock" },
    ]);
    // City C is already htbt, so no htbt is forced.
    expect(r.report.prompts[0]!.forced.filter((f) => f.to === "htbt")).toEqual([]);
  });

  it("guarantees a main (top share) and, for lists ≥ 12, an htbt (lowest share)", () => {
    // 20 equal guesses → equal shares of 0.045 (side): no main, no htbt.
    const p = prompt("flat", { rarity: "guess" }, 0);
    p.answers = Array.from({ length: 20 }, (_, i) => answer(`Fest ${String.fromCharCode(65 + i)}`, "side"));
    p.answers[19] = { ...p.answers[19]!, flag: "tote" }; // flagged answers are never forced
    const r = build([p]);
    const pr = promptOf(r, "flat");
    const forced = r.report.prompts[0]!.forced;
    expect(forced.map((f) => f.to)).toEqual(["main", "htbt"]);
    expect(pr.answers.filter((a) => a.tier === "main")).toHaveLength(1);
    expect(pr.answers.filter((a) => a.tier === "htbt")).toHaveLength(1);
    expect(byName(pr, "Fest T").tier).toBe("tote");
    expect(pr.answers[0]!.tier).toBe("main");
    expect(pr.answers[pr.answers.length - 1]!.tier).toBe("htbt");
    expect(r.report.prompts[0]!.warnings.join()).toMatch(/tiers forced/);

    // Short lists (< 12) don't get a forced htbt.
    const short = prompt("short", { rarity: "guess" }, 0);
    short.answers = Array.from({ length: 11 }, (_, i) => answer(`S ${String.fromCharCode(65 + i)}`, "tent"));
    const rs = build([short]);
    expect(rs.report.prompts[0]!.forced).toEqual([]);
    expect(promptOf(rs, "short").answers.some((a) => a.tier === "htbt")).toBe(false);
  });

  it("reports drift of ≥ 2 tiers from the guess", () => {
    const { p, fame } = fameFixture("fame");
    const r = build([p], { fame });
    const drifts = r.report.prompts[0]!.drifts;
    // Everyone guessed "tent": City A (main) is 2 steps more common.
    expect(drifts.find((d) => d.name === "City A")).toMatchObject({ guess: "tent", tier: "main", steps: -2 });
    expect(drifts.every((d) => Math.abs(d.steps) >= 2)).toBe(true);
  });

  it("reports missing and disambiguation wiki titles", () => {
    const p = prompt("hall");
    p.answers.push(answer("Ghost Fest", "tent", { wiki: "Ghost Fest" }), answer("Mercury", "tent", { wiki: "Mercury" }));
    const fame = fameCache({
      "Ghost Fest": { views: 0, missing: true, canonical: null },
      Mercury: { views: 900, disambiguation: true },
    });
    const rep = build([p], { fame }).report.prompts[0]!;
    expect(rep.missingWiki).toEqual(["Ghost Fest"]);
    expect(rep.disambiguationWiki).toEqual(["Mercury"]);
    expect(rep.warnings.join("\n")).toMatch(/1 wiki titles do not exist: Ghost Fest/);
  });
});
