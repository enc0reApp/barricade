import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { indexPack, validatePack } from "../../lib/content/loader";
import type { PackAnswer, PackCatalogEntry, PackPrompt } from "../../lib/content/types";
import {
  buildCatalogIndex,
  buildPromptIndex,
  MAX_TYPED_CHARS,
  matchAnswer,
  type MatchResult,
} from "../../lib/game/match";
import { matchKeys } from "../../lib/game/normalize";

const FIXTURE = fileURLToPath(new URL("../fixtures/pack.json", import.meta.url));
const loaded = indexPack(validatePack(JSON.parse(readFileSync(FIXTURE, "utf8"))), "env", FIXTURE);

function prompt(id: string): PackPrompt {
  const p = loaded.pack.puzzles.flatMap((z) => z.prompts).find((x) => x.id === id);
  if (!p) throw new Error(`no fixture prompt ${id}`);
  return p;
}

function m(promptId: string, typed: string): MatchResult {
  const p = prompt(promptId);
  return matchAnswer(p, typed, { prompt: loaded.promptIndex(p), catalog: loaded.catalog });
}

/** "accepted:<id>" / "typo:<id>" / "offprompt:<id>" / "unknown" / "empty" */
function outcome(r: MatchResult): string {
  switch (r.kind) {
    case "accepted":
      return `${r.typo ? "typo" : "accepted"}:${r.answer.id}`;
    case "offprompt":
      return `offprompt:${r.entry.id}`;
    default:
      return r.kind;
  }
}

const o = (promptId: string, typed: string) => outcome(m(promptId, typed));

describe("matchAnswer — exact", () => {
  it("accepts the canonical name, any case/punctuation", () => {
    expect(o("berlin-clubs", "Berghain")).toBe("accepted:venue:berghain");
    expect(o("berlin-clubs", "  BERGHAIN!!  ")).toBe("accepted:venue:berghain");
    expect(o("berlin-clubs", "berghain?")).toBe("accepted:venue:berghain");
    expect(o("drum-machines", "roland tr 808")).toBe("accepted:gear:roland-tr-808");
  });

  it("an excited trailing '!' doesn't break short names", () => {
    // normalize() reads "m!" as "mi" (P!nk rule); the matcher also tries the text without it.
    expect(o("detroit-labels", "KMS!")).toBe("accepted:label:kms");
    expect(o("berlin-clubs", "OHM!!!")).toBe("accepted:venue:ohm");
    // An interior "!" keeps the P!nk rule.
    const pink: PackAnswer = { id: "artist:pink", name: "P!nk", type: "artist", tier: "main", share: 0.2, keys: matchKeys("P!nk") };
    const p: PackPrompt = { id: "x", text: "Name a pop star", types: ["artist"], difficulty: 1, seconds: 25, answers: [pink] };
    const idx = { prompt: buildPromptIndex(p), catalog: buildCatalogIndex([]) };
    expect(outcome(matchAnswer(p, "P!nk", idx))).toBe("accepted:artist:pink");
    expect(outcome(matchAnswer(p, "pink", idx))).toBe("accepted:artist:pink");
  });

  it("accepts aliases", () => {
    expect(o("uk-festivals", "Glasto")).toBe("accepted:festival:glastonbury");
    expect(o("drum-machines", "808")).toBe("accepted:gear:roland-tr-808");
    expect(o("berlin-clubs", "Kit Kat Club")).toBe("accepted:venue:kitkatclub");
    expect(o("tomorrowland-countries", "USA")).toBe("accepted:country:united-states");
  });

  it("folds accents both ways", () => {
    expect(o("lollapalooza-cities", "Sao Paulo")).toBe("accepted:city:sao-paulo");
    expect(o("lollapalooza-cities", "SÃO PAULO")).toBe("accepted:city:sao-paulo");
    expect(o("berlin-clubs", "Saule")).toBe("accepted:venue:saule");
    expect(o("berlin-clubs", "Griessmuhle")).toBe("accepted:venue:griessmuhle");
    expect(o("ibiza-clubs", "Ushuaia")).toBe("accepted:venue:ushuaia");
    expect(o("ibiza-clubs", "Hi Ibiza")).toBe("accepted:venue:hi-ibiza");
  });

  it("ignores a leading 'the' on either side", () => {
    expect(o("berlin-clubs", "The Berghain")).toBe("accepted:venue:berghain");
    expect(o("glastonbury-stages", "The Other Stage")).toBe("accepted:stage:other-stage");
    expect(o("glastonbury-stages", "Park")).toBe("accepted:stage:park");
  });

  it("handles &/and/n, spacing and number words", () => {
    expect(o("dance-genres", "Drum & Bass")).toBe("accepted:genre:drum-and-bass");
    expect(o("dance-genres", "drum n bass")).toBe("accepted:genre:drum-and-bass");
    expect(o("dance-genres", "drumandbass")).toBe("accepted:genre:drum-and-bass");
    expect(o("sound-systems", "d and b audiotechnik")).toBe("accepted:soundsystem:d-and-b-audiotechnik");
    expect(o("dutch-festivals", "Defqon One")).toBe("accepted:festival:defqon-1");
    expect(o("glastonbury-stages", "Block 9")).toBe("accepted:stage:block9");
  });
});

describe("matchAnswer — typos", () => {
  it("forgives typos within the budget and marks them", () => {
    expect(o("berlin-clubs", "Berghian")).toBe("typo:venue:berghain"); // transposition, len 8 → budget 2
    expect(o("uk-festivals", "Creamfeilds")).toBe("typo:festival:creamfields");
    expect(o("uk-festivals", "Glastonbery")).toBe("typo:festival:glastonbury");
    expect(o("berlin-clubs", "Tresorr")).toBe("typo:venue:tresor"); // min len 6 → budget 1
    expect(o("boiler-room-cities", "Lagso")).toBe("typo:city:lagos"); // len 5 → budget 1
    expect(o("dutch-festivals", "Strange Sounds From Beyonde")).toBe("typo:festival:strange-sounds-from-beyond");
  });

  it("refuses typos over the budget", () => {
    expect(o("berlin-clubs", "Bergxxxn")).toBe("unknown"); // 3 edits on 8 chars
    expect(o("berlin-clubs", "Tresssor")).toBe("unknown"); // 2 edits, budget 1
    expect(o("boiler-room-cities", "Lgaso")).toBe("unknown"); // 2 edits on 5 chars
  });

  it("keeps short names exact-only", () => {
    expect(o("berlin-clubs", "OHM")).toBe("accepted:venue:ohm");
    expect(o("berlin-clubs", "Ohn")).toBe("unknown");
    expect(o("ibiza-clubs", "Eden")).toBe("accepted:venue:eden");
    expect(o("ibiza-clubs", "Edem")).toBe("unknown");
    expect(o("ibiza-clubs", "DC10")).toBe("accepted:venue:dc-10");
    expect(o("ibiza-clubs", "DC11")).toBe("unknown");
    expect(o("detroit-labels", "KMZ")).toBe("unknown");
  });

  it("prefers the closest key, then the higher share", () => {
    // "junno" is 1 edit from the shared alias "juno" (len 4 → budget 0 → no) and
    // 2 edits from juno60/juno106 (min len 5 → budget 1 → no): nothing.
    expect(o("roland-synths", "Junno")).toBe("unknown");
    // "juno160": 1 edit from juno106? no (transposition 0↔6 is 1 edit) → juno106.
    expect(o("roland-synths", "Juno-160")).toBe("typo:gear:juno-106");
  });
});

describe("matchAnswer — shared keys", () => {
  it("an alias shared by two answers goes to the higher share", () => {
    expect(o("uk-festivals", "Reading and Leeds")).toBe("accepted:festival:reading-festival");
    expect(o("uk-festivals", "Reading & Leeds")).toBe("accepted:festival:reading-festival");
    expect(o("roland-synths", "Juno")).toBe("accepted:gear:juno-106");
  });

  it("an answer whose NAME is the key beats a higher-share alias", () => {
    expect(o("detroit-labels", "Submerge")).toBe("accepted:label:submerge");
  });

  it("accepts an alias written for the same entity in another prompt (catalog ⇒ prompt)", () => {
    // "Sampa" is only listed under boiler-room-cities, but it is the same city.
    expect(o("lollapalooza-cities", "Sampa")).toBe("accepted:city:sao-paulo");
  });
});

describe("matchAnswer — off-prompt", () => {
  it("names a real thing that isn't an answer here", () => {
    const r = m("uk-festivals", "Berghain");
    expect(r.kind).toBe("offprompt");
    if (r.kind === "offprompt") expect({ name: r.entry.name, type: r.entry.type }).toEqual({ name: "Berghain", type: "venue" });
    expect(o("uk-festivals", "Coachella")).toBe("offprompt:festival:coachella");
    expect(o("detroit-techno-artists", "Daft Punk")).toBe("offprompt:artist:daft-punk");
    expect(o("berlin-clubs", "Chicago")).toBe("offprompt:city:chicago");
  });

  it("an exact hit on another real entity beats a fuzzy accept", () => {
    // "France" is 1 edit from "Trance" but is a real country.
    expect(o("dance-genres", "France")).toBe("offprompt:country:france");
    expect(o("tomorrowland-countries", "Trance")).toBe("offprompt:genre:trance");
    // …while a non-entity typo still gets the benefit of the doubt.
    expect(o("dance-genres", "Trancee")).toBe("typo:genre:trance");
  });

  it("fuzzy off-prompt only at distance 1 and length ≥ 6", () => {
    expect(o("uk-festivals", "Berghian")).toBe("offprompt:venue:berghain");
    expect(o("uk-festivals", "Coachela")).toBe("offprompt:festival:coachella");
    expect(o("uk-festivals", "Berhgaim")).toBe("unknown"); // 2 edits
    expect(o("uk-festivals", "Pacah")).toBe("unknown"); // too short
  });

  it("prefers a catalog entity whose type the prompt accepts", () => {
    const answer: PackAnswer = { id: "venue:a", name: "Alpha", type: "venue", tier: "main", share: 0.5, keys: matchKeys("Alpha") };
    const p: PackPrompt = { id: "p", text: "Name a label", types: ["label"], difficulty: 1, seconds: 25, answers: [answer] };
    const catalog: PackCatalogEntry[] = [
      { id: "artist:shared", name: "Shared", type: "artist", keys: matchKeys("Shared") },
      { id: "label:shared-records", name: "Shared Records", type: "label", keys: [...matchKeys("Shared Records"), ...matchKeys("Shared")] },
    ];
    const r = matchAnswer(p, "Shared", { prompt: buildPromptIndex(p), catalog: buildCatalogIndex(catalog) });
    expect(outcome(r)).toBe("offprompt:label:shared-records");
  });
});

describe("matchAnswer — unknown / empty / caps", () => {
  it("unknown for things nobody has heard of", () => {
    expect(o("uk-festivals", "Not A Real Festival At All")).toBe("unknown");
    expect(o("uk-festivals", "The")).toBe("unknown");
  });

  it("empty for nothing usable", () => {
    expect(o("uk-festivals", "")).toBe("empty");
    expect(o("uk-festivals", "    ")).toBe("empty");
    expect(o("uk-festivals", "!!!")).toBe("empty");
    expect(o("uk-festivals", "a")).toBe("empty");
    expect(o("uk-festivals", "é")).toBe("empty");
  });

  it(`looks at ${MAX_TYPED_CHARS} characters at most (after trimming)`, () => {
    expect(o("berlin-clubs", `${"x".repeat(MAX_TYPED_CHARS)}Berghain`)).toBe("unknown");
    expect(o("berlin-clubs", `${" ".repeat(200)}Berghain${" ".repeat(200)}`)).toBe("accepted:venue:berghain");
    // 80 chars that end in the answer still match; one more leading char pushes it out.
    const pad = (n: number) => `${"-".repeat(n)}Berghain`;
    expect(pad(72).length).toBe(80);
    expect(o("berlin-clubs", pad(72))).toBe("accepted:venue:berghain");
    expect(o("berlin-clubs", pad(73))).toBe("typo:venue:berghain"); // "berghai" — one deletion
    expect(o("berlin-clubs", pad(76))).toBe("unknown"); // "bergh"
  });

  it("is deterministic", () => {
    const a = o("roland-synths", "Juno");
    for (let i = 0; i < 5; i++) expect(o("roland-synths", "Juno")).toBe(a);
  });
});

describe("matchAnswer — scale", () => {
  it("stays fast with ~1,000 answers × 3 keys and ~20,000 catalog keys", () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const word = (min: number, max: number) => {
      const len = min + Math.floor(rand() * (max - min + 1));
      let s = "";
      for (let i = 0; i < len; i++) s += String.fromCharCode(97 + Math.floor(rand() * 26));
      return s;
    };
    const answers: PackAnswer[] = Array.from({ length: 1000 }, (_, i) => {
      const name = `${word(4, 9)} ${word(3, 8)}`;
      return { id: `artist:a${i}`, name, type: "artist", tier: "side", share: rand(), keys: [...matchKeys(name), word(5, 12), word(6, 14)] };
    });
    const p: PackPrompt = { id: "big", text: "Name a thing", types: ["artist"], difficulty: 1, seconds: 25, answers };
    const catalog: PackCatalogEntry[] = Array.from({ length: 10_000 }, (_, i) => ({
      id: `artist:c${i}`,
      name: `c${i}`,
      type: "artist",
      keys: [word(4, 16), word(4, 16)],
    }));
    const indexes = { prompt: buildPromptIndex(p), catalog: buildCatalogIndex(catalog) };
    const queries = Array.from({ length: 300 }, () => `${word(4, 9)} ${word(3, 8)}`);
    const t0 = performance.now();
    for (const q of queries) matchAnswer(p, q, indexes);
    const perQuery = (performance.now() - t0) / queries.length;
    expect(perQuery).toBeLessThan(10);
    // Sanity: a known answer with one typo is still found at this scale.
    const target = answers[500]!;
    const key = matchKeys(target.name)[0]!;
    const typo = key.length > 7 ? `${key.slice(0, 3)}${key[4]}${key[3]}${key.slice(5)}` : key;
    const r = matchAnswer(p, typo, indexes);
    expect(r.kind).toBe("accepted");
  });
});
