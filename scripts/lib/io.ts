/**
 * Shared file I/O + CLI helpers for the content scripts.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FameCache } from "../../lib/content/fame";
import type { SourceFileInput, ValidationIssue } from "../../lib/content/validate";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface ContentPaths {
  sample: boolean;
  sourceDir: string;
  promptsDir: string;
  schedulePath: string;
  fameCachePath: string;
  packPath: string;
  reportPath: string;
}

export function contentPaths(sample: boolean, root = REPO_ROOT): ContentPaths {
  if (sample) {
    const base = join(root, "content", "sample");
    return {
      sample,
      sourceDir: join(base, "source"),
      promptsDir: join(base, "source", "prompts"),
      schedulePath: join(base, "source", "schedule.json"),
      fameCachePath: join(base, ".cache", "fame.json"),
      packPath: join(base, "pack.json"),
      reportPath: join(base, "report.json"),
    };
  }
  const src = join(root, "content", "source");
  return {
    sample,
    sourceDir: src,
    promptsDir: join(src, "prompts"),
    schedulePath: join(src, "schedule.json"),
    fameCachePath: join(src, ".cache", "fame.json"),
    packPath: join(root, "content", "build", "pack.json"),
    reportPath: join(root, "content", "build", "report.json"),
  };
}

/** Path relative to the repo root, for messages. */
export function rel(p: string): string {
  return relative(REPO_ROOT, p) || ".";
}

export function hasFlag(args: readonly string[], name: string): boolean {
  return args.includes(`--${name}`);
}

export function flagValue(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}

export function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function writeJson(path: string, data: unknown, pretty = true): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, (pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)) + "\n");
}

export interface SourceRead {
  prompts: SourceFileInput[];
  schedule: SourceFileInput | null;
  /** Unreadable / invalid JSON files. */
  parseIssues: ValidationIssue[];
}

/** Read every prompts/*.json and schedule.json under a source dir. Paths in results are repo-relative. */
export function readSources(paths: ContentPaths): SourceRead {
  const prompts: SourceFileInput[] = [];
  const parseIssues: ValidationIssue[] = [];
  const files = existsSync(paths.promptsDir)
    ? readdirSync(paths.promptsDir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];
  for (const f of files) {
    const full = join(paths.promptsDir, f);
    try {
      prompts.push({ file: rel(full), data: readJson(full) });
    } catch (e) {
      parseIssues.push({ severity: "error", file: rel(full), message: `invalid JSON: ${(e as Error).message}` });
    }
  }
  let schedule: SourceFileInput | null = null;
  if (existsSync(paths.schedulePath)) {
    try {
      schedule = { file: rel(paths.schedulePath), data: readJson(paths.schedulePath) };
    } catch (e) {
      parseIssues.push({ severity: "error", file: rel(paths.schedulePath), message: `invalid JSON: ${(e as Error).message}` });
    }
  }
  return { prompts, schedule, parseIssues };
}

export function readFameCache(path: string): FameCache | null {
  if (!existsSync(path)) return null;
  const data = readJson<FameCache>(path);
  if (!data || typeof data !== "object" || typeof data.entries !== "object") {
    throw new Error(`${rel(path)} is not a fame cache`);
  }
  return data;
}

/* ───────────── terminal colour (only on a TTY, honours NO_COLOR) ───────────── */

const useColor = !!process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  red: wrap("31"),
  yellow: wrap("33"),
  green: wrap("32"),
  cyan: wrap("36"),
  dim: wrap("2"),
  bold: wrap("1"),
  magenta: wrap("35"),
};

/** Print issues grouped by file. Returns [errors, warnings]. */
export function printIssues(issues: readonly ValidationIssue[], opts: { warnings?: boolean } = {}): [number, number] {
  const showWarnings = opts.warnings ?? true;
  const byFile = new Map<string, ValidationIssue[]>();
  for (const i of issues) {
    if (i.severity === "warning" && !showWarnings) continue;
    byFile.set(i.file, [...(byFile.get(i.file) ?? []), i]);
  }
  for (const [file, list] of [...byFile].sort(([a], [b]) => (a < b ? -1 : 1))) {
    console.log(c.bold(file));
    for (const i of [...list].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1))) {
      const tag = i.severity === "error" ? c.red("  ERROR  ") : c.yellow("  warn   ");
      console.log(`${tag}${i.message}`);
    }
  }
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  return [errors, warnings];
}
