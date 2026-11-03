/**
 * Source validation for content/source (and content/sample/source).
 *
 * Pure: takes already-parsed JSON plus the file it came from, returns issues.
 * Errors block a build; warnings are editorial nudges (docs/CONTENT.md).
 */

import { isDateString } from "../game/day";
import { matchKeys, primaryKey } from "../game/normalize";
import { ROUNDS_PER_SET } from "../game/tiers";
import { ENTITY_TYPES, type EntityType, type SourcePrompt, type SourceSchedule } from "./types";

export type Severity = "error" | "warning";

export interface ValidationIssue {
  severity: Severity;
  /** File the issue belongs to (path as given by the caller). */
  file: string;
  message: string;
}

export interface SourceFileInput {
  /** Path, used for messages and the slug ≠ filename check. */
  file: string;
  data: unknown;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** Prompts that passed the shape check (may still carry other errors). */
  prompts: SourcePrompt[];
  schedule: SourceSchedule | null;
}

export const SOURCE_GUESSES = ["main", "side", "tent", "basement", "htbt"] as const;
export const SOURCE_FLAGS = ["tote", "htbt", "lock"] as const;
export const RARITY_MODES = ["blend", "guess", "fame"] as const;

export const LIMITS = {
  minAnswers: 25,
  maxNoWikiShare: 0.4,
  minRarerThanSide: 3,
  minDistinctPrimaryTypes: 4,
  maxArtistPrompts: 2,
  maxTextLength: 80,
  maxNoteLength: 90,
  maxToteFlags: 2,
  minSeconds: 5,
  maxSeconds: 120,
} as const;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROMPT_KEYS = new Set([
  "slug",
  "text",
  "hint",
  "types",
  "difficulty",
  "boundary",
  "rarity",
  "seconds",
  "answers",
  "sources",
  "notes",
]);
const ANSWER_KEYS = new Set(["name", "type", "aliases", "wiki", "guess", "flag", "note"]);

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}
function isEntityType(x: unknown): x is EntityType {
  return typeof x === "string" && (ENTITY_TYPES as readonly string[]).includes(x);
}
function oneOf<T extends string>(list: readonly T[], x: unknown): x is T {
  return typeof x === "string" && (list as readonly string[]).includes(x);
}

/** "content/source/prompts/uk-festivals.json" → "uk-festivals". */
export function slugFromFile(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? file;
  return base.replace(/\.json$/i, "");
}

/* ───────────────────────────── prompts ───────────────────────────── */

/**
 * Validate one prompt file. Returns the issues and, when the shape is sound
 * enough to use, the typed prompt.
 */
export function validatePrompt(
  data: unknown,
  file: string,
): { prompt: SourcePrompt | null; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const err = (message: string) => issues.push({ severity: "error", file, message });
  const warn = (message: string) => issues.push({ severity: "warning", file, message });

  if (!isObject(data)) {
    err("prompt file must contain a JSON object");
    return { prompt: null, issues };
  }

  for (const k of Object.keys(data)) if (!PROMPT_KEYS.has(k)) warn(`unknown field "${k}"`);

  // slug
  const slug = data.slug;
  if (!isNonEmptyString(slug)) err("slug: required string");
  else {
    if (!SLUG_RE.test(slug)) err(`slug "${slug}" must be kebab-case (a-z, 0-9, single hyphens)`);
    const expected = slugFromFile(file);
    if (expected && slug !== expected) err(`slug "${slug}" does not match file name "${expected}.json"`);
  }

  // text
  const text = data.text;
  if (!isNonEmptyString(text)) err("text: required string");
  else {
    if (!/^Name\b/.test(text.trim())) warn(`text should start with "Name": "${text}"`);
    if (text.length > LIMITS.maxTextLength) warn(`text is ${text.length} chars (> ${LIMITS.maxTextLength})`);
  }

  if (data.hint !== undefined && typeof data.hint !== "string") err("hint: must be a string");

  // types
  const types = data.types;
  let typesOk = false;
  if (!Array.isArray(types) || types.length === 0) err("types: required non-empty array");
  else {
    typesOk = true;
    const seen = new Set<string>();
    for (const t of types) {
      if (!isEntityType(t)) {
        err(`types: "${String(t)}" is not one of ${ENTITY_TYPES.join(", ")}`);
        typesOk = false;
      } else if (seen.has(t)) warn(`types: "${t}" listed twice`);
      else seen.add(t);
    }
  }

  // difficulty
  const difficulty = data.difficulty;
  if (!(typeof difficulty === "number" && Number.isInteger(difficulty) && difficulty >= 1 && difficulty <= 5)) {
    err("difficulty: must be an integer 1–5");
  }

  if (!isNonEmptyString(data.boundary)) err("boundary: required string");

  if (data.rarity !== undefined && !oneOf(RARITY_MODES, data.rarity)) {
    err(`rarity: must be one of ${RARITY_MODES.join(", ")}`);
  }

  if (data.seconds !== undefined) {
    const s = data.seconds;
    if (!(typeof s === "number" && Number.isInteger(s) && s >= LIMITS.minSeconds && s <= LIMITS.maxSeconds)) {
      err(`seconds: must be an integer ${LIMITS.minSeconds}–${LIMITS.maxSeconds}`);
    }
  }

  if (!Array.isArray(data.sources) || !data.sources.every((s) => typeof s === "string")) {
    err("sources: required array of strings");
  } else if (data.sources.length === 0) warn("sources: empty — say where the list came from");

  if (data.notes !== undefined && typeof data.notes !== "string") err("notes: must be a string");

  // answers
  const answers = data.answers;
  let answersOk = false;
  if (!Array.isArray(answers)) err("answers: required array");
  else if (answers.length === 0) err("answers: empty");
  else {
    answersOk = true;
    const declared = new Set(Array.isArray(types) ? types.filter(isEntityType) : []);
    answers.forEach((a, i) => {
      const where = `answers[${i}]${isObject(a) && typeof a.name === "string" ? ` "${a.name}"` : ""}`;
      if (!isObject(a)) {
        err(`${where}: must be an object`);
        answersOk = false;
        return;
      }
      for (const k of Object.keys(a)) if (!ANSWER_KEYS.has(k)) warn(`${where}: unknown field "${k}"`);
      if (!isNonEmptyString(a.name)) {
        err(`${where}: name: required string`);
        answersOk = false;
      } else if (!primaryKey(a.name)) {
        err(`${where}: name normalises to nothing — it can never be matched`);
      }
      if (!isEntityType(a.type)) {
        err(`${where}: type "${String(a.type)}" is not one of ${ENTITY_TYPES.join(", ")}`);
        answersOk = false;
      } else if (declared.size && !declared.has(a.type)) {
        warn(`${where}: type "${a.type}" is not in the prompt's types [${[...declared].join(", ")}]`);
      }
      if (a.aliases !== undefined) {
        if (!Array.isArray(a.aliases) || !a.aliases.every(isNonEmptyString)) {
          err(`${where}: aliases: must be an array of non-empty strings`);
          answersOk = false;
        }
      }
      if (!("wiki" in a)) err(`${where}: wiki: required (use null when there is no article)`);
      else if (a.wiki !== null && !isNonEmptyString(a.wiki)) err(`${where}: wiki: must be a title string or null`);
      if (!oneOf(SOURCE_GUESSES, a.guess)) {
        err(`${where}: guess: must be one of ${SOURCE_GUESSES.join(", ")}`);
        answersOk = false;
      }
      if (a.flag !== undefined && !oneOf(SOURCE_FLAGS, a.flag)) {
        err(`${where}: flag: must be one of ${SOURCE_FLAGS.join(", ")}`);
      }
      if (a.note !== undefined) {
        if (typeof a.note !== "string") err(`${where}: note: must be a string`);
        else if (a.note.length > LIMITS.maxNoteLength) {
          warn(`${where}: note is ${a.note.length} chars (> ${LIMITS.maxNoteLength})`);
        }
      }
    });
  }

  const shapeOk =
    isNonEmptyString(slug) &&
    isNonEmptyString(text) &&
    typesOk &&
    typeof difficulty === "number" &&
    answersOk &&
    Array.isArray(data.sources);
  if (!shapeOk) return { prompt: null, issues };

  const prompt = data as unknown as SourcePrompt;
  checkPromptSemantics(prompt, err, warn);
  return { prompt, issues };
}

/** Key-level and editorial checks on a well-shaped prompt. */
function checkPromptSemantics(
  p: SourcePrompt,
  err: (m: string) => void,
  warn: (m: string) => void,
): void {
  const answers = p.answers;

  // Duplicate answers (same primary key of name).
  const byNameKey = new Map<string, number>();
  answers.forEach((a, i) => {
    const k = primaryKey(a.name);
    if (!k) return;
    const prev = byNameKey.get(k);
    if (prev !== undefined) err(`duplicate answer: "${a.name}" and "${answers[prev]!.name}" (key "${k}")`);
    else byNameKey.set(k, i);
  });

  // Alias/name keys pointing at two different answers.
  const owner = new Map<string, { idx: number; label: string }>();
  for (const [k, i] of byNameKey) owner.set(k, { idx: i, label: `name "${answers[i]!.name}"` });
  answers.forEach((a, i) => {
    const seenOwn = new Set<string>([primaryKey(a.name)]);
    const covered = new Set<string>(matchKeys(a.name));
    for (const alias of a.aliases ?? []) {
      const k = primaryKey(alias);
      if (!k) {
        warn(`"${a.name}": alias "${alias}" normalises to nothing`);
        continue;
      }
      const keys = matchKeys(alias);
      if (keys.every((x) => covered.has(x))) {
        warn(`"${a.name}": alias "${alias}" adds nothing — normalisation already matches it`);
        continue;
      }
      for (const x of keys) covered.add(x);
      if (seenOwn.has(k)) continue;
      seenOwn.add(k);
      const prev = owner.get(k);
      if (prev && prev.idx !== i) {
        err(`alias "${alias}" of "${a.name}" collides with ${prev.label} of "${answers[prev.idx]!.name}" (key "${k}")`);
      } else if (!prev) owner.set(k, { idx: i, label: `alias "${alias}"` });
    }
  });

  // Two answers pointing at one article share its fame (and look like a duplicate).
  const byWiki = new Map<string, string>();
  for (const a of answers) {
    if (!a.wiki) continue;
    const k = a.wiki.replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    const prev = byWiki.get(k);
    if (prev) warn(`"${a.name}" and "${prev}" share the wiki title "${a.wiki}"`);
    else byWiki.set(k, a.name);
  }

  // Editorial warnings.
  if (answers.length < LIMITS.minAnswers) warn(`only ${answers.length} answers (< ${LIMITS.minAnswers})`);
  const noWiki = answers.filter((a) => !a.wiki).length;
  if (answers.length && noWiki / answers.length > LIMITS.maxNoWikiShare) {
    warn(`${noWiki}/${answers.length} answers (${Math.round((100 * noWiki) / answers.length)}%) have no wiki title`);
  }
  if (!answers.some((a) => a.guess === "main")) warn(`no answer has guess "main"`);
  const rare = answers.filter(
    (a) => a.flag === "htbt" || a.guess === "tent" || a.guess === "basement" || a.guess === "htbt",
  ).length;
  if (rare < LIMITS.minRarerThanSide) warn(`only ${rare} answers rarer than "side" (< ${LIMITS.minRarerThanSide})`);
  const totes = answers.filter((a) => a.flag === "tote").length;
  if (totes > LIMITS.maxToteFlags) warn(`${totes} tote flags (> ${LIMITS.maxToteFlags})`);
}

/* ───────────────────────────── schedule ───────────────────────────── */

export function validateSchedule(
  data: unknown,
  file: string,
  prompts: ReadonlyMap<string, SourcePrompt>,
): { schedule: SourceSchedule | null; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const err = (message: string) => issues.push({ severity: "error", file, message });
  const warn = (message: string) => issues.push({ severity: "warning", file, message });

  if (!isObject(data)) {
    err("schedule must be a JSON object { epoch, days }");
    return { schedule: null, issues };
  }
  for (const k of Object.keys(data)) if (k !== "epoch" && k !== "days") warn(`unknown field "${k}"`);

  if (!isDateString(data.epoch)) err(`epoch: "${String(data.epoch)}" is not a valid YYYY-MM-DD date`);

  if (!Array.isArray(data.days)) {
    err("days: required array");
    return { schedule: null, issues };
  }
  if (data.days.length === 0) warn("days: empty — nothing to play");

  const usedAt = new Map<string, number>();
  let shapeOk = isDateString(data.epoch);
  data.days.forEach((d, i) => {
    const label = isObject(d) && typeof d.number === "number" ? `day #${d.number}` : `days[${i}]`;
    if (!isObject(d)) {
      err(`${label}: must be an object`);
      shapeOk = false;
      return;
    }
    for (const k of Object.keys(d)) if (k !== "number" && k !== "title" && k !== "prompts") warn(`${label}: unknown field "${k}"`);
    if (!(typeof d.number === "number" && Number.isInteger(d.number))) {
      err(`${label}: number must be an integer`);
      shapeOk = false;
    } else if (d.number !== i + 1) {
      err(`${label}: numbers must run 1, 2, 3… in order (expected ${i + 1})`);
    }
    if (d.title !== undefined && typeof d.title !== "string") err(`${label}: title must be a string`);
    if (!Array.isArray(d.prompts) || !d.prompts.every((s) => typeof s === "string")) {
      err(`${label}: prompts must be an array of slugs`);
      shapeOk = false;
      return;
    }
    const slugs = d.prompts as string[];
    if (slugs.length !== ROUNDS_PER_SET) err(`${label}: has ${slugs.length} prompts (needs exactly ${ROUNDS_PER_SET})`);
    const dayPrompts: SourcePrompt[] = [];
    for (const s of slugs) {
      const p = prompts.get(s);
      if (!p) err(`${label}: prompt "${s}" does not exist (or failed validation)`);
      else dayPrompts.push(p);
      const prev = usedAt.get(s);
      if (prev !== undefined) {
        err(`${label}: prompt "${s}" already used ${prev === d.number ? "earlier this day" : `on day #${prev}`}`);
      } else usedAt.set(s, d.number as number);
    }
    checkDayMix(label, dayPrompts, warn);
  });

  return { schedule: shapeOk ? (data as unknown as SourceSchedule) : null, issues };
}

function checkDayMix(label: string, prompts: SourcePrompt[], warn: (m: string) => void): void {
  if (prompts.length === 0) return;
  const primary = prompts.map((p) => p.types[0]);
  const distinct = new Set(primary);
  if (distinct.size < LIMITS.minDistinctPrimaryTypes) {
    warn(`${label}: only ${distinct.size} distinct primary types (${[...distinct].join(", ")}; want ≥ ${LIMITS.minDistinctPrimaryTypes})`);
  }
  const artists = primary.filter((t) => t === "artist").length;
  if (artists > LIMITS.maxArtistPrompts) warn(`${label}: ${artists} artist prompts (> ${LIMITS.maxArtistPrompts})`);
  for (let i = 1; i < prompts.length; i++) {
    const a = prompts[i - 1]!;
    const b = prompts[i]!;
    if (b.difficulty < a.difficulty) {
      warn(`${label}: difficulty drops from ${a.difficulty} ("${a.slug}") to ${b.difficulty} ("${b.slug}")`);
    }
  }
}

/* ───────────────────────────── everything ───────────────────────────── */

export function validateSource(input: {
  prompts: SourceFileInput[];
  schedule: SourceFileInput | null;
}): ValidationResult {
  const issues: ValidationIssue[] = [];
  const prompts: SourcePrompt[] = [];
  const bySlug = new Map<string, SourcePrompt>();
  const fileOfSlug = new Map<string, string>();

  for (const f of input.prompts) {
    const r = validatePrompt(f.data, f.file);
    issues.push(...r.issues);
    if (!r.prompt) continue;
    const prev = fileOfSlug.get(r.prompt.slug);
    if (prev) {
      issues.push({ severity: "error", file: f.file, message: `slug "${r.prompt.slug}" already used by ${prev}` });
      continue;
    }
    fileOfSlug.set(r.prompt.slug, f.file);
    // Only error-free prompts may be scheduled.
    if (!r.issues.some((x) => x.severity === "error")) bySlug.set(r.prompt.slug, r.prompt);
    prompts.push(r.prompt);
  }

  let schedule: SourceSchedule | null = null;
  if (!input.schedule) {
    issues.push({ severity: "error", file: "schedule.json", message: "schedule.json is missing" });
  } else {
    const r = validateSchedule(input.schedule.data, input.schedule.file, bySlug);
    issues.push(...r.issues);
    schedule = r.schedule;
  }

  return {
    issues,
    errors: issues.filter((i) => i.severity === "error"),
    warnings: issues.filter((i) => i.severity === "warning"),
    prompts,
    schedule,
  };
}
