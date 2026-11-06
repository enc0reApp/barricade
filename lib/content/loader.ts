/**
 * Server-only content loader. Reads the ContentPack once per process and
 * caches it with its lookup indexes.
 *
 * Resolution order:
 *   0. BARRICADE_PACK_PATH (tests / tooling) — plain or sealed JSON
 *   a. BARRICADE_SEAL_KEY set AND content/sealed/pack.json.enc exists → unseal
 *   b. content/build/pack.json (local dev with real content — never in production)
 *   c. content/sample/pack.json (public sample, floats onto any date)
 *
 * Production (NODE_ENV=production) fails closed with PackConfigError:
 *   - a sealed pack without BARRICADE_SEAL_KEY is an error, not a fallback;
 *   - content/build is never read;
 *   - the public sample (any pack of kind "sample", from any source) is
 *     refused unless BARRICADE_ALLOW_SAMPLE=1 (demo / Preview deploys).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { addDays, isDateString, liveDateWindow, numberForDate } from "../game/day";
import { buildCatalogIndex, buildPromptIndex, type CatalogIndex, type MatchIndexes, type PromptIndex } from "../game/match";
import { NORMALIZE_VERSION } from "../game/normalize";
import { isSealedFile, unseal } from "./seal";
import type { ContentPack, PackCatalogEntry, PackPrompt, PackPuzzle } from "./types";

export type PackSource = "env" | "sealed" | "build" | "sample";

/** The deployment's content is misconfigured (routes answer `server`, never a silent fallback). */
export class PackConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackConfigError";
  }
}

export interface LoadedPack {
  pack: ContentPack;
  source: PackSource;
  /** Absolute path the pack was read from. */
  file: string;
  /**
   * Pack identity: kind + epoch, hashed. Stable across content rebuilds of the
   * same pack, different between the sample and production. Signed into every
   * round token and receipt (`h`) so they never score on another pack.
   */
  id: string;
  /** Every catalog entity (receipt lookups). Answer matching uses catalogFor(date). */
  catalog: CatalogIndex;
  /**
   * The catalog as of a date: entities from puzzles dated on or before it, plus
   * entities in no puzzle. Off-prompt replies built from it never confirm an
   * answer from a set that isn't out yet. Sample packs: the whole catalog.
   */
  catalogFor(date: string): CatalogIndex;
  /** Production packs: date → puzzle. */
  byDate: Map<string, PackPuzzle>;
  /** Highest scheduled puzzle number (production cap for latestNumber). */
  maxNumber: number;
  /** Lazily built, memoised per prompt object (at most once per pack). */
  promptIndex(prompt: PackPrompt): PromptIndex;
}

let cached: Promise<LoadedPack> | null = null;

/** Tests: forget the cached pack (e.g. after changing BARRICADE_PACK_PATH). */
export function resetPackCache(): void {
  cached = null;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function parsePackFile(file: string, sealKey: string | undefined): unknown {
  const raw = readJson(file);
  if (!isSealedFile(raw)) return raw;
  if (!sealKey) throw new Error(`Content pack ${file} is sealed but BARRICADE_SEAL_KEY is not set`);
  return JSON.parse(unseal(raw, sealKey));
}

const isProduction = () => process.env.NODE_ENV === "production";
const sampleAllowed = () => process.env.BARRICADE_ALLOW_SAMPLE === "1";

const SAMPLE_REFUSED =
  "refusing to serve the public sample pack in production: commit content/sealed/pack.json.enc and set " +
  "BARRICADE_SEAL_KEY (or set BARRICADE_ALLOW_SAMPLE=1 for a demo deploy)";

function resolvePackFile(): { file: string; source: PackSource } {
  const fromEnv = process.env.BARRICADE_PACK_PATH;
  if (fromEnv) return { file: path.resolve(/*turbopackIgnore: true*/ fromEnv), source: "env" };
  const sealKey = process.env.BARRICADE_SEAL_KEY;
  const prod = isProduction();
  // Literal paths so the bundler traces exactly these files (next.config.ts
  // outputFileTracingIncludes ships content/sealed + the sample pack).
  const sealed = path.join(process.cwd(), "content", "sealed", "pack.json.enc");
  const hasSealed = existsSync(sealed);
  if (sealKey && hasSealed) return { file: sealed, source: "sealed" };
  if (prod && hasSealed) {
    throw new PackConfigError("content/sealed/pack.json.enc is present but BARRICADE_SEAL_KEY is not set");
  }
  if (!prod) {
    // Plaintext spoilers: dev only, and kept out of the server bundle's file traces.
    const build = path.join(/*turbopackIgnore: true*/ process.cwd(), "content", "build", "pack.json");
    if (existsSync(build)) return { file: build, source: "build" };
  }
  if (prod && !sampleAllowed()) throw new PackConfigError(SAMPLE_REFUSED);
  const sample = path.join(process.cwd(), "content", "sample", "pack.json");
  if (existsSync(sample)) return { file: sample, source: "sample" };
  throw new Error(
    "No BARRICADE content pack found. Expected content/sample/pack.json (pnpm content:sample), " +
      "content/build/pack.json (pnpm content:build), or content/sealed/pack.json.enc + BARRICADE_SEAL_KEY.",
  );
}

/** Structural sanity check. Throws with a clear message on anything that would break gameplay. */
export function validatePack(x: unknown, file = "pack"): ContentPack {
  if (typeof x !== "object" || x === null) throw new Error(`${file}: not a JSON object`);
  const p = x as Partial<ContentPack>;
  if (p.format !== 1) throw new Error(`${file}: unsupported pack format ${String(p.format)}`);
  if (p.normalizeVersion !== NORMALIZE_VERSION) {
    throw new Error(
      `${file}: pack was built with normalizeVersion ${String(p.normalizeVersion)} but the runtime is ` +
        `NORMALIZE_VERSION ${NORMALIZE_VERSION}. Rebuild content (pnpm content:build / content:sample).`,
    );
  }
  if (p.kind !== "sample" && p.kind !== "production") throw new Error(`${file}: bad kind ${String(p.kind)}`);
  if (!isDateString(p.epoch)) throw new Error(`${file}: bad epoch ${String(p.epoch)}`);
  if (!Array.isArray(p.puzzles)) throw new Error(`${file}: puzzles must be an array`);
  if (!Array.isArray(p.catalog)) throw new Error(`${file}: catalog must be an array`);
  for (const puzzle of p.puzzles) {
    if (!puzzle || !Array.isArray(puzzle.prompts) || puzzle.prompts.length === 0) {
      throw new Error(`${file}: puzzle #${String(puzzle?.number)} has no prompts`);
    }
    if (!Number.isInteger(puzzle.number) || puzzle.number < 1 || !isDateString(puzzle.date)) {
      throw new Error(`${file}: puzzle #${String(puzzle.number)} has a bad number/date`);
    }
    for (const prompt of puzzle.prompts) {
      if (!prompt || typeof prompt.text !== "string" || !Array.isArray(prompt.answers)) {
        throw new Error(`${file}: puzzle #${puzzle.number} has a malformed prompt`);
      }
    }
  }
  return p as ContentPack;
}

/** Pack identity for tokens: base64url of the first 8 bytes of sha256("kind:epoch"). */
export function packIdentity(pack: Pick<ContentPack, "kind" | "epoch">): string {
  return createHash("sha256").update(`${pack.kind}:${pack.epoch}`).digest().subarray(0, 8).toString("base64url");
}

/** How many date-filtered catalog indexes to keep (live dates + a few archive ones). */
const RELEASED_CATALOG_CACHE = 8;

export function indexPack(pack: ContentPack, source: PackSource, file: string): LoadedPack {
  const byDate = new Map<string, PackPuzzle>();
  let maxNumber = 0;
  // Earliest scheduled date of every entity that is an answer somewhere.
  const firstDate = new Map<string, string>();
  for (const puzzle of pack.puzzles) {
    if (!byDate.has(puzzle.date)) byDate.set(puzzle.date, puzzle);
    if (puzzle.number > maxNumber) maxNumber = puzzle.number;
    for (const prompt of puzzle.prompts) {
      for (const answer of prompt.answers) {
        const prev = firstDate.get(answer.id);
        if (prev === undefined || puzzle.date < prev) firstDate.set(answer.id, puzzle.date);
      }
    }
  }
  const catalog = buildCatalogIndex(pack.catalog);
  // Scheduled dates, ascending: the filtered catalog only changes on these.
  const dates = [...new Set(pack.puzzles.map((z) => z.date))].sort();
  const lastDate = dates[dates.length - 1];
  const released = new Map<string, CatalogIndex>();
  const catalogFor = (date: string): CatalogIndex => {
    if (pack.kind !== "production" || lastDate === undefined || date >= lastDate) return catalog;
    // The latest scheduled date on or before `date` decides what is out.
    let cutoff: string | null = null;
    for (const d of dates) {
      if (d > date) break;
      cutoff = d;
    }
    const cacheKey = cutoff ?? "";
    let idx = released.get(cacheKey);
    if (!idx) {
      idx = buildCatalogIndex(
        pack.catalog.filter((e) => {
          const first = firstDate.get(e.id);
          return first === undefined || (cutoff !== null && first <= cutoff);
        }),
      );
      if (released.size >= RELEASED_CATALOG_CACHE) released.delete(released.keys().next().value as string);
      released.set(cacheKey, idx);
    }
    return idx;
  };
  const promptIndexes = new WeakMap<PackPrompt, PromptIndex>();
  return {
    pack,
    source,
    file,
    id: packIdentity(pack),
    catalog,
    catalogFor,
    byDate,
    maxNumber,
    promptIndex(prompt) {
      let idx = promptIndexes.get(prompt);
      if (!idx) {
        idx = buildPromptIndex(prompt);
        promptIndexes.set(prompt, idx);
      }
      return idx;
    },
  };
}

let warnedSampleInProd = false;

async function load(): Promise<LoadedPack> {
  const { file, source } = resolvePackFile();
  const pack = validatePack(parsePackFile(file, process.env.BARRICADE_SEAL_KEY), file);
  if (pack.kind === "sample" && isProduction()) {
    // Also covers BARRICADE_PACK_PATH (or a sealed file) that turns out to be the sample.
    if (!sampleAllowed()) throw new PackConfigError(SAMPLE_REFUSED);
    if (!warnedSampleInProd) {
      warnedSampleInProd = true;
      console.warn("[barricade] serving the PUBLIC SAMPLE pack in production (BARRICADE_ALLOW_SAMPLE=1).");
    }
  }
  return indexPack(pack, source, file);
}

/** The loaded pack + indexes (cached per process; a failed load is retried next call). */
export function getLoadedPack(): Promise<LoadedPack> {
  if (!cached) {
    cached = load().catch((err: unknown) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}

export async function getPack(): Promise<ContentPack> {
  return (await getLoadedPack()).pack;
}

/** The puzzle for a calendar date. Sample packs float onto every date from their epoch on. */
export function puzzleForDate(loaded: LoadedPack, date: string): PackPuzzle | null {
  if (!isDateString(date)) return null;
  const { pack } = loaded;
  if (pack.kind === "production") return loaded.byDate.get(date) ?? null;
  const number = numberForDate(pack.epoch, date);
  const len = pack.puzzles.length;
  if (number < 1 || len === 0) return null;
  const base = pack.puzzles[(number - 1) % len];
  if (!base) return null;
  return { ...base, number, date };
}

/** Number of the latest live date's puzzle (0 before launch). Production caps at the last scheduled puzzle. */
export function latestNumberFor(loaded: LoadedPack, nowMs: number): number {
  const n = numberForDate(loaded.pack.epoch, liveDateWindow(nowMs).latest);
  if (n < 1) return 0;
  return loaded.pack.kind === "production" ? Math.min(n, loaded.maxNumber) : n;
}

/** The next scheduled night, without exposing its prompts or answers. */
export function nextDateFor(loaded: LoadedPack, date: string): string | null {
  if (loaded.pack.kind === "sample") return addDays(date, 1);
  return [...loaded.byDate.keys()].filter((d) => d > date).sort()[0] ?? null;
}

export async function getPuzzle(date: string): Promise<PackPuzzle | null> {
  return puzzleForDate(await getLoadedPack(), date);
}

export async function latestNumber(nowMs: number): Promise<number> {
  return latestNumberFor(await getLoadedPack(), nowMs);
}

/** Matcher indexes for one prompt of the loaded pack, as of `date` (see LoadedPack.catalogFor). */
export async function getMatchIndexes(prompt: PackPrompt, date: string): Promise<MatchIndexes> {
  const loaded = await getLoadedPack();
  return { prompt: loaded.promptIndex(prompt), catalog: loaded.catalogFor(date) };
}

/** A catalog entity by id (used when a receipt's answer is no longer on its prompt). */
export async function getCatalogEntry(id: string): Promise<PackCatalogEntry | null> {
  return (await getLoadedPack()).catalog.byId.get(id) ?? null;
}
