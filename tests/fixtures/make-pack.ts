/**
 * Builds the engine test fixtures from the small hand-written lists below.
 *
 *   npx tsx tests/fixtures/make-pack.ts
 *
 * Writes tests/fixtures/pack.json (kind "production", 2 dated puzzles) and
 * tests/fixtures/sample-pack.json (same prompts, kind "sample", floats).
 * Keys come from matchKeys, exactly as the real content compiler builds them.
 *
 * These are TEST lists — deliberately tiny and not real BARRICADE content.
 * A few entries exist only to exercise matcher edge cases:
 *   - "Reading and Leeds" is an alias of two answers (higher share wins)
 *   - "Juno" is an alias of two answers (higher share wins)
 *   - "Submerge" is one answer's NAME and another's alias (name wins)
 *   - São Paulo has the alias "Sampa" only in the Boiler Room prompt (catalog ⇒ prompt)
 *   - "Trance" (genre) and "France" (country) are one edit apart (exact catalog beats fuzzy)
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ContentPack, EntityType, PackAnswer, PackCatalogEntry, PackPrompt } from "../../lib/content/types";
import { NORMALIZE_VERSION, matchKeys, normalize } from "../../lib/game/normalize";
import type { TierId } from "../../lib/game/tiers";

interface Def {
  name: string;
  tier: TierId;
  share?: number;
  aliases?: string[];
  note?: string;
  type?: EntityType;
}

const DEFAULT_SHARE: Record<TierId, number> = {
  main: 0.15,
  tote: 0.05,
  side: 0.03,
  tent: 0.008,
  basement: 0.002,
  htbt: 0.0005,
};

const a = (name: string, tier: TierId, share?: number, extra: Omit<Def, "name" | "tier" | "share"> = {}): Def => ({
  name,
  tier,
  share,
  ...extra,
});

interface PromptDef {
  id: string;
  text: string;
  hint?: string;
  types: EntityType[];
  difficulty: number;
  seconds?: number;
  answers: Def[];
}

const slug = (s: string) => normalize(s).replace(/ /g, "-");
const idFor = (type: EntityType, name: string) => `${type}:${slug(name)}`;

function keysFor(name: string, aliases: readonly string[] = []): string[] {
  return [...new Set([name, ...aliases].flatMap((s) => matchKeys(s)))];
}

const PUZZLE_1: PromptDef[] = [
  {
    id: "uk-festivals",
    text: "Name a music festival held in the UK",
    hint: "Past or present.",
    types: ["festival"],
    difficulty: 1,
    answers: [
      a("Glastonbury", "main", 0.3, { aliases: ["Glastonbury Festival", "Glasto"] }),
      a("Reading Festival", "main", 0.2, { aliases: ["Reading", "Reading and Leeds"] }),
      a("Leeds Festival", "main", 0.12, { aliases: ["Leeds", "Reading and Leeds"] }),
      a("Download Festival", "main", 0.1, { aliases: ["Download"] }),
      a("Boomtown", "tote", 0.05, { aliases: ["Boomtown Fair"] }),
      a("Creamfields", "side", 0.04),
      a("Field Day", "side", 0.03),
      a("Boardmasters", "side", 0.025),
      a("Green Man", "tent", 0.01, { note: "In the Brecon Beacons since 2003" }),
      a("Bestival", "tent", 0.008),
      a("Houghton", "basement", 0.003, { note: "Craig Richards' festival in the Norfolk woods" }),
      a("Lovebox", "basement", 0.002),
      a("Field Maneuvers", "htbt", 0.0006, { note: "Secret-location dance festival, capped at a few thousand" }),
      a("Freerotation", "htbt", 0.0005),
      a("Gottwood", "htbt", 0.0004),
    ],
  },
  {
    id: "berlin-clubs",
    text: "Name a club in Berlin",
    types: ["venue"],
    difficulty: 2,
    answers: [
      a("Berghain", "main", 0.35),
      a("Tresor", "side", 0.05),
      a("Watergate", "side", 0.04),
      a("Panorama Bar", "side", 0.03, { aliases: ["Panoramabar"] }),
      a("Sisyphos", "tent", 0.012, { note: "Built in an old dog-biscuit factory" }),
      a("KitKatClub", "tent", 0.01, { aliases: ["Kit Kat Club", "KitKat"] }),
      a("About Blank", "tent", 0.009, { aliases: ["://about blank"] }),
      a("Ritter Butzke", "basement", 0.003),
      a("Griessmühle", "basement", 0.002, { aliases: ["Griessmuehle"] }),
      a("OHM", "htbt", 0.0008, { note: "Tiny room in a former power station" }),
      a("Säule", "htbt", 0.0005),
    ],
  },
  {
    id: "dance-genres",
    text: "Name a genre of electronic dance music",
    types: ["genre"],
    difficulty: 1,
    answers: [
      a("House", "main", 0.25),
      a("Techno", "main", 0.22),
      a("Drum and bass", "main", 0.15, { aliases: ["DnB", "D and B"] }),
      a("Dubstep", "side", 0.05),
      a("Trance", "side", 0.04),
      a("UK garage", "side", 0.035, { aliases: ["UKG", "Garage"] }),
      a("Jungle", "tote", 0.05),
      a("Hardstyle", "tent", 0.012),
      a("Footwork", "tent", 0.01),
      a("Breakcore", "basement", 0.003),
      a("Gqom", "basement", 0.002, { note: "Durban's broken-beat house sound" }),
      a("Speed garage", "htbt", 0.0007),
    ],
  },
  {
    id: "lollapalooza-cities",
    text: "Name a city that has hosted a Lollapalooza",
    hint: "Any edition, past or present.",
    types: ["city"],
    difficulty: 3,
    answers: [
      a("Chicago", "main", 0.5),
      a("Berlin", "side", 0.05),
      a("Paris", "side", 0.04),
      a("São Paulo", "tent", 0.012),
      a("Santiago", "tent", 0.01),
      a("Buenos Aires", "tent", 0.009),
      a("Stockholm", "basement", 0.003),
      a("Mumbai", "basement", 0.002, { aliases: ["Bombay"] }),
    ],
  },
  {
    id: "sound-systems",
    text: "Name a sound system",
    hint: "Speaker brands and sound-system crews both count.",
    types: ["soundsystem"],
    difficulty: 3,
    answers: [
      a("Funktion-One", "main", 0.3, { aliases: ["F1"] }),
      a("L-Acoustics", "main", 0.12),
      a("d&b audiotechnik", "side", 0.05, { aliases: ["dnb audiotechnik"] }),
      a("Void Acoustics", "side", 0.03, { aliases: ["Void"] }),
      a("Meyer Sound", "side", 0.025, { aliases: ["Meyer"] }),
      a("Martin Audio", "tent", 0.01),
      a("Stone Love", "tent", 0.008, { aliases: ["Stone Love Movement"], note: "Kingston dancehall sound since 1972" }),
      a("Jah Shaka", "basement", 0.003, { aliases: ["Jah Shaka Sound System"] }),
      a("Channel One", "basement", 0.002, { aliases: ["Channel One Sound System"] }),
      a("Saxon Studio", "htbt", 0.0005, { aliases: ["Saxon", "Saxon Sound"] }),
    ],
  },
  {
    id: "drum-machines",
    text: "Name a drum machine",
    types: ["gear"],
    difficulty: 4,
    answers: [
      a("Roland TR-808", "main", 0.4, { aliases: ["808", "TR-808"] }),
      a("Roland TR-909", "main", 0.2, { aliases: ["909", "TR-909"] }),
      a("Akai MPC60", "tote", 0.05, { aliases: ["MPC60", "MPC"] }),
      a("LinnDrum", "side", 0.03, { aliases: ["LM-2"] }),
      a("Roland TR-707", "tent", 0.01, { aliases: ["707", "TR-707"] }),
      a("E-mu SP-1200", "tent", 0.009, { aliases: ["SP-1200"] }),
      a("Elektron Machinedrum", "basement", 0.002, { aliases: ["Machinedrum"] }),
      a("Simmons SDS-V", "htbt", 0.0005, { aliases: ["SDS-V", "SDS5"] }),
    ],
  },
  {
    id: "glastonbury-stages",
    text: "Name a stage or area at Glastonbury",
    types: ["stage"],
    difficulty: 4,
    seconds: 20,
    answers: [
      a("Pyramid Stage", "main", 0.45, { aliases: ["Pyramid"] }),
      a("Other Stage", "main", 0.2),
      a("Arcadia", "tote", 0.06, { aliases: ["Arcadia Spectacular"] }),
      a("West Holts", "side", 0.04),
      a("Avalon", "side", 0.03),
      a("Shangri-La", "tent", 0.012),
      a("The Park", "tent", 0.01, { aliases: ["Park Stage"] }),
      a("Block9", "basement", 0.003),
      a("Acoustic Stage", "basement", 0.002),
      a("Strummerville", "htbt", 0.0006, { note: "Campfire area named for Joe Strummer" }),
      a("Williams Green", "htbt", 0.0005),
    ],
  },
];

const PUZZLE_2: PromptDef[] = [
  {
    id: "detroit-techno-artists",
    text: "Name a Detroit techno artist",
    types: ["artist"],
    difficulty: 2,
    answers: [
      a("Jeff Mills", "main", 0.3),
      a("Juan Atkins", "main", 0.2),
      a("Derrick May", "main", 0.15),
      a("Drexciya", "tote", 0.05),
      a("Kevin Saunderson", "side", 0.05),
      a("Carl Craig", "side", 0.04),
      a("Underground Resistance", "side", 0.03, { aliases: ["UR"] }),
      a("Robert Hood", "tent", 0.012),
      a("Moodymann", "tent", 0.01, { aliases: ["Kenny Dixon Jr"] }),
      a("Theo Parrish", "basement", 0.003),
      a("Omar S", "basement", 0.002),
      a("DJ Stingray", "htbt", 0.0005, { aliases: ["Stingray 313"] }),
    ],
  },
  {
    id: "detroit-labels",
    text: "Name a record label from Detroit",
    types: ["label"],
    difficulty: 4,
    answers: [
      a("Motown", "main", 0.4),
      a("Underground Resistance", "side", 0.05, { aliases: ["UR", "Submerge"] }),
      a("Transmat", "side", 0.03),
      a("KMS", "tent", 0.01),
      a("Planet E", "tent", 0.008, { aliases: ["Planet E Communications"] }),
      a("Submerge", "tent", 0.004),
      a("Metroplex", "basement", 0.003),
      a("Sound Signature", "basement", 0.002),
      a("FXHE", "htbt", 0.0006, { note: "Omar S's own label" }),
      a("Mahogani Music", "htbt", 0.0005, { aliases: ["Mahogani"] }),
    ],
  },
  {
    id: "ibiza-clubs",
    text: "Name a club in Ibiza",
    hint: "Defunct ones count.",
    types: ["venue"],
    difficulty: 2,
    answers: [
      a("Amnesia", "main", 0.3),
      a("Pacha", "main", 0.25),
      a("Ushuaïa", "main", 0.15, { aliases: ["Ushuaia Ibiza"] }),
      a("Space", "tote", 0.05, { note: "Closed in 2016" }),
      a("Hï Ibiza", "side", 0.05),
      a("DC-10", "side", 0.04),
      a("Privilege", "side", 0.03, { aliases: ["Ku", "Privilege Ibiza"] }),
      a("Eden", "tent", 0.01),
      a("Es Paradis", "tent", 0.008),
      a("Sankeys Ibiza", "basement", 0.002),
      a("Cova Santa", "htbt", 0.0005),
    ],
  },
  {
    id: "tomorrowland-countries",
    text: "Name a country that has hosted a Tomorrowland",
    hint: "Any edition, any spin-off.",
    types: ["country"],
    difficulty: 3,
    answers: [
      a("Belgium", "main", 0.6),
      a("United States", "side", 0.05, { aliases: ["USA", "US", "America"] }),
      a("Brazil", "side", 0.04),
      a("France", "side", 0.03, { note: "Tomorrowland Winter, Alpe d'Huez" }),
    ],
  },
  {
    id: "boiler-room-cities",
    text: "Name a city Boiler Room has broadcast from",
    types: ["city"],
    difficulty: 3,
    answers: [
      a("London", "main", 0.3),
      a("Berlin", "main", 0.2),
      a("New York", "side", 0.05, { aliases: ["NYC", "New York City"] }),
      a("Los Angeles", "side", 0.04, { aliases: ["LA"] }),
      a("Amsterdam", "side", 0.03),
      a("Tokyo", "tent", 0.01),
      a("Johannesburg", "tent", 0.008, { aliases: ["Joburg"] }),
      a("São Paulo", "tent", 0.006, { aliases: ["Sampa", "SP"] }),
      a("Tbilisi", "basement", 0.003),
      a("Lagos", "basement", 0.002),
      a("Kyiv", "htbt", 0.0005, { aliases: ["Kiev"] }),
    ],
  },
  {
    id: "roland-synths",
    text: "Name a synthesizer made by Roland",
    types: ["gear"],
    difficulty: 4,
    answers: [
      a("Juno-106", "main", 0.25, { aliases: ["Juno"] }),
      a("TB-303", "main", 0.2, { aliases: ["303"] }),
      a("Juno-60", "side", 0.04, { aliases: ["Juno"] }),
      a("Jupiter-8", "side", 0.035, { aliases: ["JP-8"] }),
      a("SH-101", "side", 0.03, { aliases: ["101"] }),
      a("Alpha Juno", "tent", 0.01),
      a("JX-3P", "tent", 0.008),
      a("MKS-80", "basement", 0.002, { aliases: ["Super Jupiter"] }),
      a("System-100", "htbt", 0.0005),
    ],
  },
  {
    id: "dutch-festivals",
    text: "Name a music festival in the Netherlands",
    types: ["festival"],
    difficulty: 3,
    answers: [
      a("Awakenings", "main", 0.25),
      a("Mysteryland", "main", 0.12),
      a("Dekmantel", "tote", 0.06),
      a("Lowlands", "side", 0.05),
      a("DGTL", "side", 0.04),
      a("Defqon.1", "side", 0.035, { aliases: ["Defqon"] }),
      a("Pinkpop", "side", 0.03),
      a("Down the Rabbit Hole", "tent", 0.01, { aliases: ["DTRH"] }),
      a("Best Kept Secret", "tent", 0.008),
      a("Draaimolen", "basement", 0.003),
      a("Strange Sounds from Beyond", "htbt", 0.0005),
    ],
  },
];

/** Real things that are not an answer to any fixture prompt. */
const CATALOG_ONLY: { name: string; type: EntityType; aliases?: string[] }[] = [
  { name: "Coachella", type: "festival", aliases: ["Coachella Valley Music and Arts Festival"] },
  { name: "Daft Punk", type: "artist" },
  { name: "Fabric", type: "venue", aliases: ["Fabric London"] },
];

function buildPrompt(def: PromptDef): PackPrompt {
  const fallbackType = def.types[0]!;
  const answers: PackAnswer[] = def.answers.map((d) => {
    const type = d.type ?? fallbackType;
    const answer: PackAnswer = {
      id: idFor(type, d.name),
      name: d.name,
      type,
      tier: d.tier,
      share: d.share ?? DEFAULT_SHARE[d.tier],
      keys: keysFor(d.name, d.aliases),
    };
    if (d.note) answer.note = d.note;
    return answer;
  });
  const prompt: PackPrompt = {
    id: def.id,
    text: def.text,
    types: def.types,
    difficulty: def.difficulty,
    seconds: def.seconds ?? 25,
    answers,
  };
  if (def.hint) prompt.hint = def.hint;
  return prompt;
}

function buildCatalog(prompts: PackPrompt[]): PackCatalogEntry[] {
  const byId = new Map<string, PackCatalogEntry>();
  const add = (id: string, name: string, type: EntityType, keys: string[]) => {
    const prev = byId.get(id);
    if (prev) prev.keys = [...new Set([...prev.keys, ...keys])];
    else byId.set(id, { id, name, type, keys: [...keys] });
  };
  for (const p of prompts) for (const ans of p.answers) add(ans.id, ans.name, ans.type, ans.keys);
  for (const c of CATALOG_ONLY) add(idFor(c.type, c.name), c.name, c.type, keysFor(c.name, c.aliases));
  return [...byId.values()].sort((x, y) => (x.id < y.id ? -1 : 1));
}

function buildPack(kind: ContentPack["kind"], epoch: string, dates: [string, string]): ContentPack {
  const p1 = PUZZLE_1.map(buildPrompt);
  const p2 = PUZZLE_2.map(buildPrompt);
  return {
    format: 1,
    normalizeVersion: NORMALIZE_VERSION,
    kind,
    generatedAt: "2026-11-01T00:00:00.000Z",
    epoch,
    puzzles: [
      { number: 1, date: dates[0], title: "FIXTURE ONE", prompts: p1 },
      { number: 2, date: dates[1], prompts: p2 },
    ],
    catalog: buildCatalog([...p1, ...p2]),
  };
}

function write(file: string, pack: ContentPack): void {
  const path = fileURLToPath(new URL(file, import.meta.url));
  writeFileSync(path, `${JSON.stringify(pack, null, 1)}\n`);
  console.log(`wrote ${path}`);
}

write("./pack.json", buildPack("production", "2026-11-09", ["2026-11-09", "2026-11-10"]));
write("./sample-pack.json", buildPack("sample", "2026-11-01", ["2026-11-01", "2026-11-02"]));
