/**
 * Content compiler: SourcePrompt[] + SourceSchedule + fame cache → ContentPack.
 *
 * Pure and deterministic for a given input (no I/O, no clock, no env). The
 * build script reads files/env and passes everything in.
 *
 * Rarity model (docs/CONTENT.md):
 *   fameShare_i ∝ views_i^α over answers with views > 0 (scaled so the famed
 *   answers carry the same total mass as their guesses, which keeps answers
 *   without fame comparable), guessShare_i = GUESS_SHARE[guess],
 *   blend = exp(0.5·ln fame + 0.5·ln guess), normalised to SHARE_TOTAL,
 *   then mapped to a tier with SHARE_THRESHOLDS. Flags win.
 */

import { dateForNumber, isDateString } from "../game/day";
import { NORMALIZE_VERSION, matchKeys, normalize, primaryKey } from "../game/normalize";
import { DEFAULT_SECONDS, GUESS_SHARE, SHARE_THRESHOLDS, TIERS, TIER_IDS, type TierId } from "../game/tiers";
import { fameFor, wikiKey, type FameCache } from "./fame";
import type {
  ContentPack,
  EntityType,
  PackAnswer,
  PackCatalogEntry,
  PackPrompt,
  PackPuzzle,
  SourceAnswer,
  SourceGuess,
  SourcePrompt,
  SourceSchedule,
} from "./types";

/** Exponent on pageviews: fame is a little more than linear in salience. */
export const FAME_EXPONENT = 1.1;
/** Shares sum to this; the rest is players who say something off-list or nothing. */
export const SHARE_TOTAL = 0.9;
/** Lists at least this long are guaranteed one YOU HAD TO BE THERE. */
export const FORCE_HTBT_MIN_ANSWERS = 12;

/** The ordinal rarity scale used for drift reporting (tote sits outside it). */
export const RARITY_SCALE = ["main", "side", "tent", "basement", "htbt"] as const satisfies readonly SourceGuess[];

export interface CompileInput {
  /** Every source prompt. All of them feed the catalog; only scheduled ones become puzzles. */
  prompts: readonly SourcePrompt[];
  schedule: SourceSchedule;
  fame: FameCache | null;
  kind: ContentPack["kind"];
  generatedAt: string;
  /** Overrides schedule.epoch (the build script passes BARRICADE_EPOCH here). */
  epochOverride?: string;
}

export interface ReportPick {
  name: string;
  tier: TierId;
  share: number;
}

export interface ReportDrift {
  name: string;
  guess: SourceGuess;
  tier: TierId;
  share: number;
  /** Mean monthly pageviews, or null when the answer had no fame. */
  views: number | null;
  /** Signed steps on main<side<tent<basement<htbt (positive = rarer than guessed). */
  steps: number;
}

export interface ReportDroppedKey {
  key: string;
  /** Answers the key was removed from. */
  droppedFrom: string[];
  /** Answers that kept it because it is one of their own name keys. */
  keptBy: string[];
}

export interface ReportForced {
  name: string;
  from: TierId;
  to: TierId;
  reason: "guarantee-main" | "guarantee-htbt";
}

export interface PromptReport {
  slug: string;
  text: string;
  rarity: "blend" | "guess" | "fame";
  difficulty: number;
  primaryType: EntityType;
  /** Day numbers this prompt is scheduled on. */
  days: number[];
  answers: number;
  /** Answers whose wiki title has views > 0 in the fame cache. */
  withFame: number;
  /** Answers whose wiki title the fame cache says does not exist. */
  missingWiki: string[];
  /** Answers whose wiki title resolves to a disambiguation page. */
  disambiguationWiki: string[];
  tiers: Record<TierId, number>;
  top: ReportPick[];
  drifts: ReportDrift[];
  droppedKeys: ReportDroppedKey[];
  forced: ReportForced[];
  flags: { name: string; flag: "tote" | "htbt" | "lock" }[];
  /** Editorial red flags worth a look. */
  warnings: string[];
}

export interface DayReport {
  number: number;
  date: string;
  title?: string;
  prompts: string[];
  answers: number;
  tiers: Record<TierId, number>;
  summary: string;
}

export interface CompileReport {
  kind: ContentPack["kind"];
  generatedAt: string;
  epoch: string;
  normalizeVersion: number;
  fame: { entries: number; fetchedAt: string | null };
  totals: {
    prompts: number;
    scheduledPrompts: number;
    days: number;
    answers: number;
    entities: number;
    mergedEntities: number;
    catalogKeys: number;
    droppedKeys: number;
    forcedTiers: number;
    promptsWithWarnings: number;
  };
  /** Entities whose base id collided and got a numeric suffix. */
  idCollisions: { id: string; name: string; base: string }[];
  days: DayReport[];
  prompts: PromptReport[];
}

export interface CompileResult {
  pack: ContentPack;
  report: CompileReport;
}

/* ───────────────────────────── helpers ───────────────────────────── */

export function slugifyName(name: string): string {
  return normalize(name).replace(/ /g, "-") || "x";
}

export function tierForShare(share: number): TierId {
  if (share >= SHARE_THRESHOLDS.main) return "main";
  if (share >= SHARE_THRESHOLDS.side) return "side";
  if (share >= SHARE_THRESHOLDS.tent) return "tent";
  if (share >= SHARE_THRESHOLDS.basement) return "basement";
  return "htbt";
}

/** Move a share into the band of a tier it was forced into (tote has no band). */
export function clampShareToTier(share: number, tier: TierId): number {
  const T = SHARE_THRESHOLDS;
  const below = (x: number) => x * 0.95;
  switch (tier) {
    case "main":
      return Math.max(share, T.main);
    case "side":
      return Math.min(Math.max(share, T.side), below(T.main));
    case "tent":
      return Math.min(Math.max(share, T.tent), below(T.side));
    case "basement":
      return Math.min(Math.max(share, T.basement), below(T.tent));
    case "htbt":
      return Math.min(share, below(T.basement));
    case "tote":
      return share;
  }
}

function guessOf(a: SourceAnswer): SourceGuess {
  // A tote without a meaningful guess sits at "tent".
  return (RARITY_SCALE as readonly string[]).includes(a.guess) ? a.guess : "tent";
}

function roundShare(x: number): number {
  return x > 0 ? Number(x.toPrecision(4)) : 0;
}

function emptyTierCounts(): Record<TierId, number> {
  return Object.fromEntries(TIER_IDS.map((t) => [t, 0])) as Record<TierId, number>;
}

function scaleIndex(t: TierId): number {
  return (RARITY_SCALE as readonly string[]).indexOf(t);
}

/* ───────────────────────────── entities ───────────────────────────── */

interface Entity {
  id: string;
  base: string;
  name: string;
  type: EntityType;
  /** Lower-cased canonical wiki title, when any answer gave one. */
  wiki: string | null;
  keys: Set<string>;
  prompts: Set<string>;
}

function canonicalWiki(fame: FameCache | null, wiki: string | null): string | null {
  if (!wiki) return null;
  const e = fameFor(fame, wiki);
  return (e && !e.missing && e.canonical ? e.canonical : wikiKey(wiki)).toLowerCase();
}

function buildEntities(prompts: readonly SourcePrompt[], fame: FameCache | null) {
  const entities: Entity[] = [];
  const byWiki = new Map<string, Entity>();
  const byName = new Map<string, Entity[]>();
  /** slug → entity per answer index */
  const answerEntity = new Map<string, Entity[]>();

  const ordered = [...prompts].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of ordered) {
    const list: Entity[] = [];
    for (const a of p.answers) {
      const wiki = canonicalWiki(fame, a.wiki);
      const nameKey = `${a.type}|${primaryKey(a.name)}`;
      // Two answers of one prompt are always two entities (e.g. two products sharing one article).
      const free = (c: Entity | undefined) => (c && !list.includes(c) ? c : undefined);
      let e: Entity | undefined = wiki ? free(byWiki.get(`${a.type}|${wiki}`)) : undefined;
      if (!e) {
        // Same type + name, unless both sides name different articles.
        e = (byName.get(nameKey) ?? []).find((c) => (!c.wiki || !wiki) && !list.includes(c));
        if (e && wiki && !e.wiki) {
          e.wiki = wiki;
          if (!byWiki.has(`${a.type}|${wiki}`)) byWiki.set(`${a.type}|${wiki}`, e);
        }
      }
      if (!e) {
        e = { id: "", base: "", name: a.name, type: a.type, wiki, keys: new Set(), prompts: new Set() };
        entities.push(e);
        if (wiki && !byWiki.has(`${a.type}|${wiki}`)) byWiki.set(`${a.type}|${wiki}`, e);
      }
      const named = byName.get(nameKey) ?? [];
      if (!named.includes(e)) byName.set(nameKey, [...named, e]);
      for (const k of matchKeys(a.name)) e.keys.add(k);
      for (const al of a.aliases ?? []) for (const k of matchKeys(al)) e.keys.add(k);
      e.prompts.add(p.slug);
      list.push(e);
    }
    answerEntity.set(p.slug, list);
  }

  const used = new Set<string>();
  const idCollisions: CompileReport["idCollisions"] = [];
  for (const e of entities) {
    const base = `${e.type}:${slugifyName(e.name)}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    e.id = id;
    e.base = base;
    if (id !== base) idCollisions.push({ id, name: e.name, base });
  }
  return { entities, answerEntity, idCollisions };
}

/* ───────────────────────────── per prompt ───────────────────────────── */

interface CompiledPrompt {
  pack: PackPrompt;
  report: PromptReport;
}

function answerKeys(p: SourcePrompt): { keys: string[][]; dropped: ReportDroppedKey[] } {
  const own = p.answers.map((a) => new Set(matchKeys(a.name)));
  const all = p.answers.map((a, i) => {
    const s = new Set(own[i]);
    for (const al of a.aliases ?? []) for (const k of matchKeys(al)) s.add(k);
    return s;
  });
  const holders = new Map<string, number[]>();
  all.forEach((set, i) => {
    for (const k of set) holders.set(k, [...(holders.get(k) ?? []), i]);
  });
  const dropped: ReportDroppedKey[] = [];
  for (const [k, idx] of holders) {
    if (idx.length < 2) continue;
    const droppedFrom: string[] = [];
    const keptBy: string[] = [];
    for (const i of idx) {
      if (own[i]!.has(k)) keptBy.push(p.answers[i]!.name);
      else {
        all[i]!.delete(k);
        droppedFrom.push(p.answers[i]!.name);
      }
    }
    dropped.push({ key: k, droppedFrom, keptBy });
  }
  dropped.sort((a, b) => (a.key < b.key ? -1 : 1));
  return { keys: all.map((s) => [...s]), dropped };
}

function compilePrompt(
  p: SourcePrompt,
  fame: FameCache | null,
  entities: Entity[],
  days: number[],
): CompiledPrompt {
  const mode = p.rarity ?? "blend";
  const n = p.answers.length;

  const fameEntries = p.answers.map((a) => fameFor(fame, a.wiki));
  const views = fameEntries.map((e) => (e && !e.missing && e.views > 0 ? e.views : 0));
  const guess = p.answers.map((a) => GUESS_SHARE[guessOf(a)]);

  let powSum = 0;
  let guessSumFamed = 0;
  views.forEach((v, i) => {
    if (v > 0) {
      powSum += v ** FAME_EXPONENT;
      guessSumFamed += guess[i]!;
    }
  });
  const fameShare = views.map((v) => (v > 0 && powSum > 0 ? ((v ** FAME_EXPONENT) / powSum) * guessSumFamed : null));

  const raw = p.answers.map((a, i) => {
    const g = guess[i]!;
    const f = fameShare[i] ?? null;
    if (a.flag === "lock" || mode === "guess") return g;
    if (mode === "fame") return f ?? g;
    return f === null ? g : Math.exp(0.5 * Math.log(f) + 0.5 * Math.log(g));
  });
  const rawSum = raw.reduce((s, x) => s + x, 0);
  const share = raw.map((x) => (rawSum > 0 ? (x / rawSum) * SHARE_TOTAL : 0));

  // Editorial guard rails. On long lists the share model dilutes the obvious
  // answers (Hendrix at Woodstock came out SIDE STAGE), so the editor's guess
  // anchors the tier and fame only nudges it:
  //  - "guess" mode: the guess, exactly.
  //  - a "main" guess stays MAIN (the obvious answers are what editors judge best).
  //  - "blend": at most one tier away from the guess.
  //  - "fame": pure fame (broad prompts), apart from the main rule.
  const tier: TierId[] = p.answers.map((a, i) => {
    if (a.flag === "tote") return "tote";
    if (a.flag === "htbt") return "htbt";
    const g = guessOf(a);
    if (a.flag === "lock" || mode === "guess") return g;
    if (g === "main") return "main";
    const t = tierForShare(share[i]!);
    if (mode === "fame") return t;
    const gr = RARITY_SCALE.indexOf(g);
    const tr = RARITY_SCALE.indexOf(t as SourceGuess);
    return RARITY_SCALE[Math.min(gr + 1, Math.max(gr - 1, tr))]!;
  });
  p.answers.forEach((a, i) => {
    if (tier[i] !== "tote" && tier[i] !== tierForShare(share[i]!)) share[i] = clampShareToTier(share[i]!, tier[i]!);
  });

  // Guarantees: ≥1 main; ≥1 htbt on long lists. Unflagged answers first, then locked.
  const forced: ReportForced[] = [];
  const candidates = (exclude: Set<number>) => {
    const free = p.answers.map((_, i) => i).filter((i) => !p.answers[i]!.flag && !exclude.has(i));
    return free.length ? free : p.answers.map((_, i) => i).filter((i) => p.answers[i]!.flag === "lock" && !exclude.has(i));
  };
  const taken = new Set<number>();
  if (!tier.includes("main")) {
    const c = candidates(taken);
    if (c.length) {
      const top = c.reduce((b, i) => (share[i]! > share[b]! ? i : b), c[0]!);
      forced.push({ name: p.answers[top]!.name, from: tier[top]!, to: "main", reason: "guarantee-main" });
      tier[top] = "main";
      share[top] = clampShareToTier(share[top]!, "main");
      taken.add(top);
    }
  } else {
    tier.forEach((t, i) => t === "main" && taken.add(i));
  }
  if (n >= FORCE_HTBT_MIN_ANSWERS && !tier.includes("htbt")) {
    const c = candidates(taken);
    if (c.length) {
      const low = c.reduce((b, i) => (share[i]! < share[b]! ? i : b), c[0]!);
      forced.push({ name: p.answers[low]!.name, from: tier[low]!, to: "htbt", reason: "guarantee-htbt" });
      tier[low] = "htbt";
      share[low] = clampShareToTier(share[low]!, "htbt");
    }
  }

  const { keys, dropped } = answerKeys(p);

  const packAnswers: PackAnswer[] = p.answers.map((a, i) => {
    const out: PackAnswer = {
      id: entities[i]!.id,
      name: a.name,
      type: a.type,
      tier: tier[i]!,
      share: roundShare(share[i]!),
      keys: keys[i]!,
    };
    if (a.note) out.note = a.note;
    return out;
  });
  const order = packAnswers
    .map((_, i) => i)
    .sort((x, y) => packAnswers[y]!.share - packAnswers[x]!.share || packAnswers[x]!.name.localeCompare(packAnswers[y]!.name));

  const pack: PackPrompt = {
    id: p.slug,
    text: p.text,
    types: [...p.types],
    difficulty: p.difficulty,
    seconds: p.seconds ?? DEFAULT_SECONDS,
    answers: order.map((i) => packAnswers[i]!),
  };
  if (p.hint) pack.hint = p.hint;

  // Report.
  const tiers = emptyTierCounts();
  for (const t of tier) tiers[t]++;
  const drifts: ReportDrift[] = [];
  p.answers.forEach((a, i) => {
    const t = tier[i]!;
    if (t === "tote") return;
    const steps = scaleIndex(t) - scaleIndex(guessOf(a));
    if (Math.abs(steps) >= 2) {
      drifts.push({ name: a.name, guess: guessOf(a), tier: t, share: roundShare(share[i]!), views: views[i]! > 0 ? views[i]! : null, steps });
    }
  });
  drifts.sort((a, b) => Math.abs(b.steps) - Math.abs(a.steps) || b.share - a.share);

  const withFame = views.filter((v) => v > 0).length;
  const missingWiki = p.answers.filter((_, i) => fameEntries[i]?.missing).map((a) => a.name);
  const disambiguationWiki = p.answers.filter((_, i) => fameEntries[i]?.disambiguation).map((a) => a.name);

  const warnings: string[] = [];
  if (n >= FORCE_HTBT_MIN_ANSWERS && tiers.htbt === 0) warnings.push("no YOU HAD TO BE THERE answer");
  if (tiers.main === 0) warnings.push("no MAIN STAGE answer");
  if (n && tiers.main / n > 0.4) warnings.push(`${Math.round((100 * tiers.main) / n)}% of answers are MAIN STAGE`);
  if (forced.length) warnings.push(`tiers forced: ${forced.map((f) => `${f.name} → ${f.to}`).join(", ")}`);
  if (n && drifts.length / n > 0.25) warnings.push(`${drifts.length}/${n} answers drift ≥ 2 tiers from the guess`);
  if (mode !== "guess" && n && fame && withFame / n < 0.5) {
    warnings.push(`only ${withFame}/${n} answers have fame (rarity mostly from guesses)`);
  }
  if (missingWiki.length) warnings.push(`${missingWiki.length} wiki titles do not exist: ${missingWiki.slice(0, 8).join(", ")}`);
  if (disambiguationWiki.length) {
    warnings.push(`${disambiguationWiki.length} wiki titles are disambiguation pages: ${disambiguationWiki.slice(0, 8).join(", ")}`);
  }
  const ambiguous = dropped.filter((d) => d.keptBy.length > 1);
  if (ambiguous.length) warnings.push(`ambiguous keys kept by 2+ answers: ${ambiguous.map((d) => d.key).join(", ")}`);
  const rarer = tiers.tent + tiers.basement + tiers.htbt;
  if (n >= FORCE_HTBT_MIN_ANSWERS && rarer < 3) warnings.push(`only ${rarer} answers rarer than SIDE STAGE`);

  const report: PromptReport = {
    slug: p.slug,
    text: p.text,
    rarity: mode,
    difficulty: p.difficulty,
    primaryType: p.types[0]!,
    days,
    answers: n,
    withFame,
    missingWiki,
    disambiguationWiki,
    tiers,
    top: order.slice(0, 5).map((i) => ({ name: packAnswers[i]!.name, tier: packAnswers[i]!.tier, share: packAnswers[i]!.share })),
    drifts,
    droppedKeys: dropped,
    forced,
    flags: p.answers.filter((a) => a.flag).map((a) => ({ name: a.name, flag: a.flag! })),
    warnings,
  };
  return { pack, report };
}

/* ───────────────────────────── compile ───────────────────────────── */

export function tierCountsLine(t: Record<TierId, number>): string {
  return TIER_IDS.map((id) => `${TIERS[id].code.toUpperCase()}${t[id]}`).join(" ");
}

export function compile(input: CompileInput): CompileResult {
  const { prompts, schedule, fame, kind, generatedAt } = input;
  const epoch = input.epochOverride ?? schedule.epoch;
  if (!isDateString(epoch)) throw new Error(`Invalid epoch "${epoch}" (want YYYY-MM-DD)`);

  const bySlug = new Map(prompts.map((p) => [p.slug, p]));
  if (bySlug.size !== prompts.length) throw new Error("Duplicate prompt slugs in compile input");

  const daysOf = new Map<string, number[]>();
  for (const d of schedule.days) {
    for (const s of d.prompts) {
      if (!bySlug.has(s)) throw new Error(`Schedule day #${d.number} references unknown prompt "${s}"`);
      daysOf.set(s, [...(daysOf.get(s) ?? []), d.number]);
    }
  }

  const { entities, answerEntity, idCollisions } = buildEntities(prompts, fame);

  const compiled = new Map<string, CompiledPrompt>();
  for (const p of [...prompts].sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
    compiled.set(p.slug, compilePrompt(p, fame, answerEntity.get(p.slug)!, daysOf.get(p.slug) ?? []));
  }

  const puzzles: PackPuzzle[] = [];
  const dayReports: DayReport[] = [];
  for (const d of schedule.days) {
    const date = dateForNumber(epoch, d.number);
    const ps = d.prompts.map((s) => compiled.get(s)!);
    const puzzle: PackPuzzle = { number: d.number, date, prompts: ps.map((c) => c.pack) };
    if (d.title) puzzle.title = d.title;
    puzzles.push(puzzle);

    const tiers = emptyTierCounts();
    let answers = 0;
    for (const c of ps) {
      answers += c.report.answers;
      for (const t of TIER_IDS) tiers[t] += c.report.tiers[t];
    }
    const diffs = ps.map((c) => c.report.difficulty);
    const flagged = ps.filter((c) => c.report.warnings.length).length;
    const summary =
      `#${d.number} ${date}${d.title ? ` "${d.title}"` : ""} · ${ps.length} prompts · d${diffs.join("")} · ` +
      `${ps.map((c) => c.report.primaryType).join("/")} · ${answers} answers · ${tierCountsLine(tiers)}` +
      (flagged ? ` · ${flagged} flagged` : "");
    const dr: DayReport = { number: d.number, date, prompts: [...d.prompts], answers, tiers, summary };
    if (d.title) dr.title = d.title;
    dayReports.push(dr);
  }

  const catalog: PackCatalogEntry[] = entities
    .map((e) => ({ id: e.id, name: e.name, type: e.type, keys: [...e.keys] }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const pack: ContentPack = {
    format: 1,
    normalizeVersion: NORMALIZE_VERSION,
    kind,
    generatedAt,
    epoch,
    puzzles,
    catalog,
  };

  const promptReports = [...compiled.values()].map((c) => c.report);
  const report: CompileReport = {
    kind,
    generatedAt,
    epoch,
    normalizeVersion: NORMALIZE_VERSION,
    fame: { entries: fame ? Object.keys(fame.entries).length : 0, fetchedAt: fame?.fetchedAt ?? null },
    totals: {
      prompts: prompts.length,
      scheduledPrompts: daysOf.size,
      days: schedule.days.length,
      answers: promptReports.reduce((s, r) => s + r.answers, 0),
      entities: entities.length,
      mergedEntities: entities.filter((e) => e.prompts.size > 1).length,
      catalogKeys: catalog.reduce((s, e) => s + e.keys.length, 0),
      droppedKeys: promptReports.reduce((s, r) => s + r.droppedKeys.length, 0),
      forcedTiers: promptReports.reduce((s, r) => s + r.forced.length, 0),
      promptsWithWarnings: promptReports.filter((r) => r.warnings.length).length,
    },
    idCollisions,
    days: dayReports,
    prompts: promptReports,
  };

  return { pack, report };
}
