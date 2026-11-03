/**
 * Source bundles for sealing: { "relative/path": "file contents" }.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize as normalizePath, sep } from "node:path";

export type SourceBundle = Record<string, string>;

const IGNORED = new Set([".DS_Store", "Thumbs.db"]);

/** Every file under `dir` (recursively, dotfiles included), keyed by POSIX-style relative path. */
export function collectBundle(dir: string): SourceBundle {
  const out: SourceBundle = {};
  const walk = (abs: string, prefix: string) => {
    for (const name of readdirSync(abs).sort()) {
      if (IGNORED.has(name)) continue;
      const full = join(abs, name);
      const relPath = prefix ? `${prefix}/${name}` : name;
      const st = statSync(full);
      if (st.isDirectory()) walk(full, relPath);
      else if (st.isFile()) out[relPath] = readFileSync(full, "utf8");
    }
  };
  if (existsSync(dir)) walk(dir, "");
  return out;
}

/** A bundle path is safe when it stays inside the target directory. */
export function isSafeBundlePath(p: string): boolean {
  if (!p || isAbsolute(p) || p.includes("\0") || p.includes("\\")) return false;
  const n = normalizePath(p);
  return !n.startsWith("..") && !n.split(sep).includes("..") && !n.split("/").includes("..");
}

export interface RestorePlan {
  /** Files that will be created or (with force) overwritten. */
  write: string[];
  /** Existing files whose contents already match. */
  same: string[];
  /** Existing files that differ (blocking unless force). */
  conflicts: string[];
  /** Paths refused because they would escape the target. */
  unsafe: string[];
}

export function planRestore(bundle: SourceBundle, targetDir: string): RestorePlan {
  const plan: RestorePlan = { write: [], same: [], conflicts: [], unsafe: [] };
  for (const [p, contents] of Object.entries(bundle)) {
    if (!isSafeBundlePath(p)) {
      plan.unsafe.push(p);
      continue;
    }
    const full = join(targetDir, p);
    if (!existsSync(full)) plan.write.push(p);
    else if (readFileSync(full, "utf8") === contents) plan.same.push(p);
    else plan.conflicts.push(p);
  }
  return plan;
}

/** Write planned files. With `force`, conflicts are overwritten too. */
export function applyRestore(bundle: SourceBundle, targetDir: string, plan: RestorePlan, force: boolean): string[] {
  const paths = force ? [...plan.write, ...plan.conflicts] : plan.write;
  for (const p of paths) {
    const full = join(targetDir, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bundle[p]!);
  }
  return paths;
}
