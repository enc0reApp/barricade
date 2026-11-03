/**
 * Restore sources and the compiled pack from content/sealed/.
 *
 *   pnpm content:unseal            # refuses to overwrite files that differ
 *   pnpm content:unseal --force    # overwrite them
 *
 *   content/sealed/source.json.enc → content/source/**
 *   content/sealed/pack.json.enc   → content/build/pack.json
 *
 * Needs BARRICADE_SEAL_KEY (env, else .env.local / .env).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { envValue } from "../lib/content/env";
import { isSealedFile, unseal } from "../lib/content/seal";
import { applyRestore, planRestore, type SourceBundle } from "./lib/bundle";
import { REPO_ROOT, c, contentPaths, hasFlag, readJson, rel } from "./lib/io";

const args = process.argv.slice(2);
const force = hasFlag(args, "force");
const key = envValue("BARRICADE_SEAL_KEY", REPO_ROOT);
if (!key) {
  console.error(c.red("BARRICADE_SEAL_KEY is not set (env or .env.local)."));
  process.exit(1);
}

const paths = contentPaths(false);
const sealedDir = join(REPO_ROOT, "content", "sealed");
const buildDir = join(REPO_ROOT, "content", "build");

function open(path: string): string | null {
  if (!existsSync(path)) {
    console.log(c.yellow(`skip: ${rel(path)} does not exist`));
    return null;
  }
  const file = readJson(path);
  if (!isSealedFile(file)) throw new Error(`${rel(path)} is not a sealed file`);
  try {
    return unseal(file, key!);
  } catch (e) {
    throw new Error(`could not unseal ${rel(path)} — wrong BARRICADE_SEAL_KEY? (${(e as Error).message})`);
  }
}

try {
  const targets: { dir: string; bundle: SourceBundle; label: string }[] = [];
  const sourceText = open(join(sealedDir, "source.json.enc"));
  if (sourceText !== null) {
    const bundle = JSON.parse(sourceText) as SourceBundle;
    targets.push({ dir: paths.sourceDir, bundle, label: "source" });
  }
  const packText = open(join(sealedDir, "pack.json.enc"));
  if (packText !== null) targets.push({ dir: buildDir, bundle: { "pack.json": packText }, label: "pack" });
  if (!targets.length) {
    console.error(c.red("Nothing to unseal."));
    process.exit(1);
  }

  // Plan everything first: refuse before writing anything.
  const plans = targets.map((t) => ({ ...t, plan: planRestore(t.bundle, t.dir) }));
  const unsafe = plans.flatMap((p) => p.plan.unsafe.map((u) => `${p.label}: ${u}`));
  if (unsafe.length) throw new Error(`refusing unsafe paths in bundle: ${unsafe.join(", ")}`);
  const conflicts = plans.flatMap((p) => p.plan.conflicts.map((f) => rel(join(p.dir, f))));
  if (conflicts.length && !force) {
    console.error(c.red(`Refusing to overwrite ${conflicts.length} files that differ (use --force):`));
    for (const f of conflicts) console.error(`  ${f}`);
    process.exit(1);
  }
  for (const p of plans) {
    applyRestore(p.bundle, p.dir, p.plan, force);
    console.log(
      `${c.green("unsealed")} ${p.label.padEnd(6)} → ${rel(p.dir)} · ${p.plan.write.length} new · ${p.plan.same.length} unchanged` +
        (force && p.plan.conflicts.length ? ` · ${p.plan.conflicts.length} overwritten` : ""),
    );
  }
} catch (e) {
  console.error(c.red((e as Error).message));
  process.exit(1);
}
