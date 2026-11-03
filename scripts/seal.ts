/**
 * Seal the production pack and a backup of its sources for the public repo.
 *
 *   pnpm content:seal
 *
 *   content/build/pack.json          → content/sealed/pack.json.enc   (label "pack")
 *   content/source/** (+ .cache)     → content/sealed/source.json.enc (label "source")
 *
 * Needs BARRICADE_SEAL_KEY (env, else .env.local / .env). Generate one with
 * `pnpm content:keygen`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { envValue } from "../lib/content/env";
import { seal, unseal } from "../lib/content/seal";
import { collectBundle } from "./lib/bundle";
import { REPO_ROOT, c, contentPaths, rel, writeJson } from "./lib/io";

const key = envValue("BARRICADE_SEAL_KEY", REPO_ROOT);
if (!key) {
  console.error(c.red("BARRICADE_SEAL_KEY is not set (env or .env.local). Generate one with: pnpm content:keygen"));
  process.exit(1);
}

const paths = contentPaths(false);
const sealedDir = join(REPO_ROOT, "content", "sealed");

if (!existsSync(paths.packPath)) {
  console.error(c.red(`No ${rel(paths.packPath)} — run pnpm content:build first.`));
  process.exit(1);
}
const packText = readFileSync(paths.packPath, "utf8");
let pack: { kind?: string; puzzles?: unknown[] };
try {
  pack = JSON.parse(packText);
} catch (e) {
  console.error(c.red(`${rel(paths.packPath)} is not valid JSON: ${(e as Error).message}`));
  process.exit(1);
}
if (pack.kind !== "production") {
  console.error(c.red(`${rel(paths.packPath)} has kind "${String(pack.kind)}", expected "production". Refusing to seal.`));
  process.exit(1);
}

const bundle = collectBundle(paths.sourceDir);
const files = Object.keys(bundle);
if (!files.some((f) => f.startsWith("prompts/"))) {
  console.error(c.red(`No prompt files under ${rel(paths.sourceDir)} — refusing to seal an empty source backup.`));
  process.exit(1);
}
const bundleText = JSON.stringify(bundle);

const out = [
  { label: "pack", text: packText, path: join(sealedDir, "pack.json.enc") },
  { label: "source", text: bundleText, path: join(sealedDir, "source.json.enc") },
];
try {
  for (const o of out) {
    const sealed = seal(o.text, key, o.label);
    // Verify before writing.
    if (unseal(sealed, key) !== o.text) throw new Error(`round-trip check failed for ${o.label}`);
    writeJson(o.path, sealed);
    console.log(`${c.green("sealed")} ${o.label.padEnd(6)} ${(o.text.length / 1024).toFixed(1)} KB → ${rel(o.path)}`);
  }
} catch (e) {
  console.error(c.red((e as Error).message));
  process.exit(1);
}
console.log(c.dim(`${pack.puzzles?.length ?? 0} puzzles · ${files.length} source files (incl. ${files.filter((f) => f.startsWith(".cache/")).length} cache)`));
