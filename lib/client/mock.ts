/**
 * A fake BARRICADE API for UI development, with the same shapes as
 * lib/api/contract.ts. Never active in production builds (see api.ts).
 *
 * Turn it on with NEXT_PUBLIC_BARRICADE_MOCK=1 or ?mock=1 (remembered for the
 * tab). Extra flavours for state work: ?mock=closed (no set tonight),
 * ?mock=error (every call fails), ?mock=slow (2s latency). ?mock=0 turns it off.
 *
 * Two fake sets of 7 prompts alternate by set number; today is always #12.
 * The answer lists are small and illustrative, not the real content.
 *
 * Proof of play (RoundRequest.prevToken/prevReceipt, FinishRequest.tokens) is
 * accepted and ignored: the mock never refuses a round or a finish for it.
 * A no-set reply carries the archive bounds (epoch, latestNumber) and a
 * not-yet crowd reply carries serverNow, which the client uses when present.
 */

import type {
  AnswerRequest,
  AnswerResponse,
  ApiFail,
  CrowdResponse,
  CrowdRound,
  FinishRequest,
  FinishResponse,
  FlagRequest,
  FlagResponse,
  RevealPick,
  RevealRound,
  RoundRequest,
  RoundResponse,
  SetResponse,
} from "../api/contract";
import type { EntityType, SourcePrompt } from "../content/types";
import woodstockSample from "../../content/sample/source/prompts/sample-woodstock-1969.json";
import countriesSample from "../../content/sample/source/prompts/sample-lollapalooza-countries.json";
import { addDays, isClosedDate, isDateString, isLiveDate, liveDateWindow, localDateString, numberForDate } from "../game/day";
import { editDistance, matchKeys, primaryKey, typoBudget } from "../game/normalize";
import { DEFAULT_SECONDS, GRACE_MS, TIERS, distanceFor, type Outcome, type TierId } from "../game/tiers";
import type { BarricadeApi, NoSetMeta } from "./api";

/* ───────────────────────────── fake content ───────────────────────────── */

type A = [name: string, tier: TierId, aliases?: string[], note?: string];

interface MockPrompt {
  text: string;
  hint?: string;
  type: EntityType;
  answers: A[];
}

interface MockSet {
  title: string;
  prompts: MockPrompt[];
}

function liveExample(source: SourcePrompt): MockPrompt {
  return {
    text: source.text,
    hint: source.hint,
    type: source.types[0]!,
    answers: source.answers.map((a): A => [a.name, a.flag === "tote" ? "tote" : a.flag === "htbt" ? "htbt" : a.guess, a.aliases, a.note]),
  };
}

const SET_A: MockSet = {
  title: "FESTIVAL SEASON",
  prompts: [
    {
      text: "Name a music festival held in the UK",
      hint: "Past or present.",
      type: "festival",
      answers: [
        ["Glastonbury", "main", ["Glasto", "Glastonbury Festival"]],
        ["Reading", "main", ["Reading Festival"]],
        ["Leeds", "main", ["Leeds Festival"]],
        ["Download", "main", ["Download Festival"]],
        ["Creamfields", "side"],
        ["Isle of Wight", "side", ["Isle of Wight Festival", "IOW"]],
        ["Parklife", "side"],
        ["Latitude", "side"],
        ["TRNSMT", "side", ["Transmit"]],
        ["Boomtown", "tote", ["Boomtown Fair"]],
        ["Green Man", "tent"],
        ["Field Day", "tent"],
        ["Bestival", "tent"],
        ["Kendal Calling", "tent"],
        ["End of the Road", "tent"],
        ["Houghton", "basement", [], "Runs for 24 hours a day, all weekend"],
        ["Gottwood", "basement"],
        ["Farr Festival", "basement", ["Farr"]],
        ["Field Maneuvers", "htbt", ["Field Manoeuvres"], "Secret-location dance festival, capped at a few thousand"],
        ["Freerotation", "htbt", [], "1,000 people in the Welsh hills. No phones on the floor."],
      ],
    },
    {
      text: "Name a genre of electronic music",
      type: "genre",
      answers: [
        ["Techno", "main"],
        ["House", "main", ["House music"]],
        ["Drum and bass", "main", ["DnB", "D and B", "Drum n bass"]],
        ["Dubstep", "main"],
        ["Trance", "main"],
        ["UK garage", "side", ["UKG", "Garage"]],
        ["Hardstyle", "side"],
        ["Amapiano", "side"],
        ["Electro", "side"],
        ["Jungle", "tote"],
        ["Footwork", "tent", ["Juke"]],
        ["Breakbeat", "tent", ["Breaks"]],
        ["Acid house", "tent"],
        ["Gabber", "tent"],
        ["Hyperpop", "tent"],
        ["Baile funk", "tent", ["Funk carioca"]],
        ["Gqom", "basement", [], "Durban's dark, broken-kick house"],
        ["Ghettotech", "basement"],
        ["Speed garage", "basement"],
        ["Singeli", "htbt", [], "Tanzanian street music, often north of 200 BPM"],
        ["Shangaan electro", "htbt"],
      ],
    },
    {
      text: "Name a Berlin nightclub",
      hint: "Past or present.",
      type: "venue",
      answers: [
        ["Berghain", "main"],
        ["Tresor", "side"],
        ["Watergate", "side"],
        ["KitKatClub", "side", ["KitKat", "Kit Kat Club"]],
        ["Sisyphos", "side"],
        ["Panorama Bar", "tote", ["Panoramabar"], "Upstairs at Berghain, so technically yes"],
        ["About Blank", "tent", ["://about blank"]],
        ["Kater Blau", "tent"],
        ["Club der Visionaere", "tent", ["CDV", "Club der Visionäre"]],
        ["Salon zur wilden Renate", "tent", ["Renate", "Wilde Renate"]],
        ["Griessmuehle", "tent", ["Grießmühle"]],
        ["Ostgut", "basement", [], "Berghain's predecessor, 1998 to 2003"],
        ["E-Werk", "basement"],
        ["Bar 25", "htbt", [], "The riverside party village that became Kater Blau"],
        ["WMF", "htbt"],
      ],
    },
    liveExample(woodstockSample as SourcePrompt),
    {
      text: "Name a festival held in a desert",
      type: "festival",
      answers: [
        ["Burning Man", "main"],
        ["Coachella", "main"],
        ["Stagecoach", "side"],
        ["AfrikaBurn", "tent", ["Afrika Burn"]],
        ["Desert Daze", "tent"],
        ["Monegros Desert Festival", "tent", ["Monegros"]],
        ["Midburn", "basement", [], "Israel's Burning Man regional, in the Negev"],
        ["Festival au Désert", "basement", ["Festival in the Desert"], "Held near Timbuktu; its last Malian edition was 2012"],
        ["Nowhere", "htbt", [], "Spain's Burning Man regional, in the Monegros desert"],
      ],
    },
    {
      text: "Name a stage at Glastonbury",
      hint: "Any year.",
      type: "stage",
      answers: [
        ["Pyramid Stage", "main", ["Pyramid"]],
        ["Other Stage", "main"],
        ["West Holts", "side"],
        ["John Peel Stage", "side", ["John Peel"]],
        ["The Park", "side", ["Park Stage"]],
        ["Arcadia", "side"],
        ["Block9", "tote", ["Block 9"]],
        ["Shangri-La", "tent", ["Shangrila"]],
        ["Avalon", "tent"],
        ["Acoustic Stage", "tent"],
        ["Woodsies", "tent"],
        ["The Glade", "tent"],
        ["Silver Hayes", "tent"],
        ["Left Field", "tent"],
        ["NYC Downlow", "basement", ["Downlow"], "Block9's queer disco tenement, fire escape and all"],
        ["Genosys", "basement"],
        ["Strummerville", "basement"],
        ["Croissant Neuf", "htbt", [], "Solar-powered big top in the Green Fields"],
      ],
    },
    liveExample(countriesSample as SourcePrompt),
  ],
};

const SET_B: MockSet = {
  title: "UNDERGROUND",
  prompts: [
    {
      text: "Name a city with a famous techno scene",
      hint: "Anywhere on Earth.",
      type: "city",
      answers: [
        ["Berlin", "main"],
        ["Detroit", "main"],
        ["Amsterdam", "side"],
        ["London", "side"],
        ["Manchester", "side"],
        ["Tbilisi", "tote", [], "Bassiani made it everyone's favourite flex"],
        ["Kyiv", "tent", ["Kiev"]],
        ["Frankfurt", "tent"],
        ["Rotterdam", "tent"],
        ["Birmingham", "tent", [], "Surgeon, Regis, Female: the Birmingham sound"],
        ["Tokyo", "tent"],
        ["Mexico City", "tent", ["CDMX"]],
        ["Leipzig", "basement"],
        ["Bucharest", "basement"],
        ["Sheffield", "htbt", [], "Warp Records started here in 1989"],
      ],
    },
    {
      text: "Name a London club, past or present",
      type: "venue",
      answers: [
        ["Fabric", "main"],
        ["Ministry of Sound", "main", ["Ministry", "MoS"]],
        ["Printworks", "side"],
        ["XOYO", "side"],
        ["Heaven", "side"],
        ["Egg London", "side", ["Egg"]],
        ["The End", "side"],
        ["Plastic People", "tote", [], "Tiny Shoreditch room, giant system. Closed 2015."],
        ["Corsica Studios", "tent", ["Corsica"]],
        ["FOLD", "tent"],
        ["Phonox", "tent"],
        ["Village Underground", "tent"],
        ["The Cross", "basement"],
        ["Venue MOT", "basement", ["MOT"]],
        ["Dalston Superstore", "basement"],
        ["Shoom", "htbt", [], "Danny Rampling's 1988 acid house night in a Southwark gym"],
        ["The Blitz", "htbt", ["Blitz Club"], "Steve Strange's New Romantic Tuesdays"],
      ],
    },
    {
      text: "Name a reggae sound system crew",
      hint: "The crews, not the speaker brands.",
      type: "soundsystem",
      answers: [
        ["Jah Shaka", "main", ["Jah Shaka Sound System"]],
        ["Stone Love", "main", ["Stone Love Movement"]],
        ["Channel One", "side"],
        ["Saxon Studio International", "side", ["Saxon", "Saxon Sound"]],
        ["King Tubby's Hometown Hi-Fi", "side", ["King Tubby", "King Tubbys"]],
        ["Aba Shanti-I", "tote", ["Aba Shanti"]],
        ["Mungo's Hi Fi", "tent", ["Mungos Hi Fi", "Mungos"]],
        ["Killamanjaro", "tent"],
        ["Iration Steppas", "tent"],
        ["Coxsone Outernational", "tent", ["Coxsone"]],
        ["Unity Hi-Fi", "basement", ["Unity"]],
        ["Volcano Hi-Power", "basement", ["Volcano"]],
        ["Sir Coxsone's Downbeat", "htbt", ["Downbeat"], "Coxsone Dodd's 1950s Kingston sound, before Studio One"],
        ["Duke Reid's Trojan", "htbt", ["Trojan", "Duke Reid"], "Named after the Trojan truck that hauled the speakers"],
      ],
    },
    {
      text: "Name a record label known for electronic music",
      type: "label",
      answers: [
        ["Warp", "main", ["Warp Records"]],
        ["Ninja Tune", "main"],
        ["XL Recordings", "main", ["XL"]],
        ["Hyperdub", "side"],
        ["Kompakt", "side"],
        ["Defected", "side", ["Defected Records"]],
        ["Ostgut Ton", "side"],
        ["Planet Mu", "tote"],
        ["R&S Records", "tent", ["R and S", "RS Records"]],
        ["Metalheadz", "tent"],
        ["Ghostly International", "tent", ["Ghostly"]],
        ["Night Slugs", "tent"],
        ["Hessle Audio", "tent", ["Hessle"]],
        ["Rephlex", "basement", [], "Aphex Twin's label, 1991 to 2014"],
        ["Livity Sound", "basement"],
        ["Basic Channel", "basement"],
        ["Chain Reaction", "htbt", [], "Basic Channel's offshoot. CDs came in metal tins."],
      ],
    },
    {
      text: "Name an Ibiza club, past or present",
      type: "venue",
      answers: [
        ["Pacha", "main"],
        ["Amnesia", "main"],
        ["Ushuaïa", "main", ["Ushuaia"]],
        ["DC-10", "tote", ["DC10"], "Next to the runway. Planes land on the beat."],
        ["Privilege", "side", ["Ku"], "Formerly Ku. Holds around 10,000."],
        ["Hï Ibiza", "side", ["Hi Ibiza"]],
        ["Space", "side", ["Space Ibiza"]],
        ["Eden", "tent"],
        ["Es Paradis", "tent"],
        ["Café del Mar", "tent", ["Cafe del Mar"]],
        ["Cova Santa", "tent"],
        ["Sankeys Ibiza", "basement", ["Sankeys"]],
        ["Underground Ibiza", "basement"],
        ["Las Dalias", "basement"],
        ["Pikes", "htbt", ["Pikes Hotel"], "Wham!'s Club Tropicana video was shot here"],
      ],
    },
    liveExample(woodstockSample as SourcePrompt),
    {
      text: "Name a music genre that came out of the UK",
      type: "genre",
      answers: [
        ["Drum and bass", "main", ["DnB", "Drum n bass"]],
        ["Dubstep", "main"],
        ["Grime", "main"],
        ["Britpop", "main"],
        ["UK garage", "side", ["UKG", "Garage"]],
        ["Trip hop", "side"],
        ["UK drill", "side", ["Drill"]],
        ["Big beat", "side"],
        ["Jungle", "tote"],
        ["2-step", "tent", ["2step", "Two step"]],
        ["Bassline", "tent"],
        ["UK funky", "tent", ["Funky"]],
        ["Shoegaze", "tent"],
        ["Madchester", "tent"],
        ["Broken beat", "basement", ["Bruk"]],
        ["Wonky", "basement"],
        ["Sublow", "htbt", [], "Grime's rough-edged 2003 cousin from east London"],
      ],
    },
  ],
};

/** Real things that aren't answers anywhere above — for "real, just not here". */
const EXTRAS: [string, EntityType][] = [
  ["The Haçienda", "venue"],
  ["Daft Punk", "artist"],
  ["Fred again..", "artist"],
  ["Tomorrowland", "festival"],
  ["Boiler Room", "other"],
  ["Ibiza", "city"],
  ["Bassiani", "venue"],
];

const MOCK_SETS = [SET_A, SET_B];

/* ───────────────────────────── indexes ───────────────────────────── */

interface IndexedAnswer {
  id: string;
  name: string;
  type: EntityType;
  tier: TierId;
  share: number;
  note?: string;
  keys: Set<string>;
  primaries: string[];
}

const TIER_SHARE: Record<TierId, number> = {
  main: 0.11,
  tote: 0.045,
  side: 0.028,
  tent: 0.008,
  basement: 0.0022,
  htbt: 0.0005,
};

function slug(s: string): string {
  return primaryKey(s) || "x";
}

function indexPrompt(p: MockPrompt): IndexedAnswer[] {
  return p.answers.map(([name, tier, aliases = [], note], i) => {
    const all = [name, ...aliases];
    const keys = new Set(all.flatMap((a) => matchKeys(a)));
    const out: IndexedAnswer = {
      id: `${p.type}:${slug(name)}`,
      name,
      type: p.type,
      tier,
      share: TIER_SHARE[tier] * (1 - (i % 4) * 0.12),
      keys,
      primaries: all.map(primaryKey).filter(Boolean),
    };
    if (note) out.note = note;
    return out;
  });
}

const INDEX = MOCK_SETS.map((s) => s.prompts.map(indexPrompt));

const CATALOG: { name: string; type: EntityType; keys: Set<string> }[] = [
  ...INDEX.flat(2).map((a) => ({ name: a.name, type: a.type, keys: a.keys })),
  ...EXTRAS.map(([name, type]) => ({ name, type, keys: new Set(matchKeys(name)) })),
];

function findAnswer(answers: IndexedAnswer[], text: string): IndexedAnswer | null {
  const keys = matchKeys(text);
  for (const a of answers) if (keys.some((k) => a.keys.has(k))) return a;
  const pk = primaryKey(text);
  if (!pk) return null;
  const budget = typoBudget(pk.length);
  if (budget === 0) return null;
  let best: IndexedAnswer | null = null;
  let bestD = budget + 1;
  for (const a of answers) {
    for (const p of a.primaries) {
      if (typoBudget(p.length) === 0) continue;
      const d = editDistance(pk, p, budget);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
  }
  return best;
}

/* ───────────────────────────── tokens ───────────────────────────── */

interface RoundToken {
  k: "r";
  d: string;
  i: number;
  n: number;
  s: number;
  p: string;
}
interface Receipt {
  k: "c";
  d: string;
  i: number;
  a: string;
  t: TierId;
  p: string;
}

function encode(obj: object): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `mock.${btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

function decode<T>(token: string): T | null {
  try {
    if (!token.startsWith("mock.")) return null;
    let b64 = token.slice(5).replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

/* ───────────────────────────── the fake server ───────────────────────────── */

export type MockFlavour = "on" | "closed" | "error" | "slow";

/** The fake server's clock runs 1.5s ahead of the browser, to exercise skew correction. */
const SKEW_MS = 1500;
const TODAY_NUMBER = 12;

function serverNow(): number {
  return Date.now() + SKEW_MS;
}

function epoch(): string {
  return addDays(localDateString(), -(TODAY_NUMBER - 1));
}

function setFor(number: number): MockSet {
  return MOCK_SETS[number % 2 === 0 ? 0 : 1]!;
}

function indexFor(number: number): IndexedAnswer[][] {
  return INDEX[number % 2 === 0 ? 0 : 1]!;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Players further back than you, as a %, from a fake bell curve of distances. */
function fakeBeatPct(distance: number): number {
  const mean = 470;
  const sd = 105;
  const z = (distance - mean) / (sd * Math.SQRT2);
  // P(D > distance) = 0.5 * erfc(z)
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  const erfz = z >= 0 ? erf : -erf;
  return Math.round(Math.min(99.9, Math.max(0.1, 50 * (1 - erfz))) * 10) / 10;
}

function liveMode(date: string): "today" | "archive" {
  return isLiveDate(date, serverNow()) ? "today" : "archive";
}

export function createMockApi(flavour: MockFlavour = "on"): BarricadeApi {
  const latency = () => wait(flavour === "slow" ? 2000 : 140 + Math.random() * 220);
  const fail = { ok: false as const, error: "server" as const, message: "mock: simulated failure" };

  const checkDate = (date: string): { ok: true; number: number } | { ok: false; error: "bad-date" | "future" | "no-set" } => {
    if (!isDateString(date)) return { ok: false, error: "bad-date" };
    if (date > liveDateWindow(serverNow()).latest) return { ok: false, error: "future" };
    const number = numberForDate(epoch(), date);
    if (number < 1) return { ok: false, error: "no-set" };
    if (flavour === "closed" && date >= localDateString()) return { ok: false, error: "no-set" };
    return { ok: true, number };
  };

  /** Latest set number playable on this device's night (closed flavour: tonight has none). */
  const latestPlayable = (): number => {
    const tonight = numberForDate(epoch(), localDateString());
    if (flavour === "closed") return tonight - 1;
    return Math.min(Math.max(1, numberForDate(epoch(), liveDateWindow(serverNow()).latest)), tonight);
  };

  return {
    async getSet(date): Promise<SetResponse> {
      await latency();
      if (flavour === "error") return fail;
      const c = checkDate(date);
      if (!c.ok) {
        if (c.error !== "no-set") return c;
        const noSet: ApiFail & NoSetMeta = { ok: false, error: "no-set", epoch: epoch(), latestNumber: latestPlayable() };
        return noSet;
      }
      const set = setFor(c.number);
      const latest = Math.max(1, numberForDate(epoch(), liveDateWindow(serverNow()).latest));
      return {
        ok: true,
        number: c.number,
        date,
        title: set.title,
        rounds: set.prompts.length,
        seconds: set.prompts.map(() => DEFAULT_SECONDS),
        mode: liveMode(date),
        pack: "sample",
        latestNumber: Math.min(latest, numberForDate(epoch(), localDateString())),
        epoch: epoch(),
      };
    },

    // req.prevToken / req.prevReceipt are accepted and ignored.
    async startRound(req: RoundRequest): Promise<RoundResponse> {
      await latency();
      if (flavour === "error") return fail;
      const c = checkDate(req.date);
      if (!c.ok) return c;
      const set = setFor(c.number);
      const p = set.prompts[req.index];
      if (!p) return { ok: false, error: "bad-request" };
      const s = serverNow();
      const token: RoundToken = { k: "r", d: req.date, i: req.index, n: c.number, s, p: req.playerId };
      const prompt = {
        index: req.index,
        total: set.prompts.length,
        text: p.text,
        types: [p.type],
        seconds: DEFAULT_SECONDS,
        ...(p.hint ? { hint: p.hint } : {}),
      };
      return { ok: true, prompt, token: encode(token), deadline: s + DEFAULT_SECONDS * 1000, serverNow: serverNow() };
    },

    async answer(req: AnswerRequest): Promise<AnswerResponse> {
      await wait(flavour === "slow" ? 900 : 90 + Math.random() * 140);
      if (flavour === "error") return fail;
      const tok = decode<RoundToken>(req.token);
      if (!tok || tok.k !== "r") return { ok: false, error: "bad-token" };
      if (serverNow() > tok.s + DEFAULT_SECONDS * 1000 + GRACE_MS) return { ok: true, status: "expired" };
      const text = String(req.text ?? "").trim().slice(0, 80);
      if (!text || !primaryKey(text)) return { ok: true, status: "rejected", reason: "empty" };
      const answers = indexFor(tok.n)[tok.i];
      if (!answers) return { ok: false, error: "bad-token" };
      const hit = findAnswer(answers, text);
      if (hit) {
        const receipt: Receipt = { k: "c", d: tok.d, i: tok.i, a: hit.id, t: hit.tier, p: tok.p };
        return {
          ok: true,
          status: "accepted",
          answer: {
            id: hit.id,
            name: hit.name,
            type: hit.type,
            tier: hit.tier,
            points: TIERS[hit.tier].points,
            share: hit.share,
            ...(hit.note ? { note: hit.note } : {}),
          },
          receipt: encode(receipt),
        };
      }
      const keys = matchKeys(text);
      const known = CATALOG.find((e) => keys.some((k) => e.keys.has(k)));
      if (known) return { ok: true, status: "rejected", reason: "offprompt", canonical: { name: known.name, type: known.type } };
      return { ok: true, status: "rejected", reason: "unknown" };
    },

    // req.tokens is accepted and ignored.
    async finish(req: FinishRequest): Promise<FinishResponse> {
      await latency();
      if (flavour === "error") return fail;
      const c = checkDate(req.date);
      if (!c.ok) return c;
      const set = setFor(c.number);
      const index = indexFor(c.number);
      const mode = liveMode(req.date);
      const outcomes: Outcome[] = [];
      const rounds: RevealRound[] = set.prompts.map((p, i) => {
        const receipt = req.receipts[i] ? decode<Receipt>(req.receipts[i]!) : null;
        const answers = index[i]!;
        const mine = receipt ? answers.find((a) => a.id === receipt.a) ?? null : null;
        outcomes.push(mine ? mine.tier : "miss");
        const picks: RevealPick[] = [];
        for (const tier of ["main", "tote", "side", "tent", "basement", "htbt"] as const) {
          const n = tier === "main" || tier === "htbt" ? 3 : 2;
          for (const a of answers.filter((x) => x.tier === tier && x.id !== mine?.id).slice(0, n)) {
            picks.push({ name: a.name, type: a.type, tier: a.tier, share: a.share, ...(a.note ? { note: a.note } : {}) });
          }
        }
        return {
          index: i,
          text: p.text,
          ...(p.hint ? { hint: p.hint } : {}),
          yours: mine
            ? {
                id: mine.id,
                name: mine.name,
                type: mine.type,
                tier: mine.tier,
                points: TIERS[mine.tier].points,
                share: mine.share,
                ...(mine.note ? { note: mine.note } : {}),
                crowdPct: mode === "today" ? Math.round(mine.share * 100 * (0.7 + (hash(mine.id) % 60) / 100) * 10) / 10 : null,
              }
            : null,
          picks,
          total: answers.length * 9,
        };
      });
      const distance = distanceFor(outcomes);
      const plays = 2800 + (hash(req.date) % 1900);
      return {
        ok: true,
        number: c.number,
        date: req.date,
        mode,
        outcomes,
        distance,
        rounds,
        crowd: mode === "today" ? { plays, beatPct: fakeBeatPct(distance) } : { plays: null, beatPct: null },
      };
    },

    async flag(_req: FlagRequest): Promise<FlagResponse> {
      await latency();
      if (flavour === "error") return fail;
      return { ok: true };
    },

    async crowd(date: string): Promise<CrowdResponse> {
      await latency();
      if (flavour === "error") return fail;
      const c = checkDate(date);
      if (!c.ok) return c;
      if (!isClosedDate(date, serverNow())) {
        const notYet: Extract<CrowdResponse, { error: "not-yet" }> & { serverNow: number } = {
          ok: false,
          error: "not-yet",
          opensAt: Date.parse(`${addDays(date, 1)}T12:00:00Z`),
          serverNow: serverNow(),
        };
        return notYet;
      }
      const set = setFor(c.number);
      const index = indexFor(c.number);
      const seed = hash(date);
      const plays = 3100 + (seed % 2400);
      const distribution = Array.from({ length: 15 }, (_, b) => {
        const mid = b * 50 + 25;
        const z = (mid - 455) / 110;
        return Math.round(plays * 0.17 * Math.exp(-0.5 * z * z) * (0.85 + ((seed >> b) & 7) / 25));
      });
      const rounds: CrowdRound[] = set.prompts.map((p, i) => {
        const answers = index[i]!;
        const top = answers.slice(0, 6).map((a, k) => ({
          name: a.name,
          tier: a.tier,
          pct: Math.round(Math.max(0.4, a.share * 100 * (2.4 - k * 0.25)) * 10) / 10,
        }));
        const lone = answers.filter((a) => a.tier === "htbt" || a.tier === "basement");
        return {
          index: i,
          text: p.text,
          top,
          singles: 3 + ((seed >> i) % 19),
          singleNames: lone.slice(0, 3).map((a) => a.name),
          missPct: Math.round((6 + ((seed >> (i + 3)) % 18)) * 10) / 10,
        };
      });
      return {
        ok: true,
        number: c.number,
        date,
        title: set.title,
        plays,
        avgDistance: 452 + (seed % 40),
        distribution,
        rounds,
      };
    },
  };
}
