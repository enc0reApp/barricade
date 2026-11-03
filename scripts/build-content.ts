/**
 * Compile sources into the runtime pack.
 *
 *   pnpm content:build              # content/source → content/build/pack.json + report.json
 *   pnpm content:sample             # content/sample/source → content/sample/pack.json + report.json
 *   --epoch YYYY-MM-DD              # override the schedule epoch
 *
 * Production builds also honour BARRICADE_EPOCH (env, .env.local or .env).
 * The sample pack keeps its own epoch unless --epoch is given.
 * Aborts on validation errors.
 */

import { existsSync } from "node:fs";
import { compile } from "../lib/content/compile";
import { envValue } from "../lib/content/env";
import type { ContentPack } from "../lib/content/types";
import { validateSource } from "../lib/content/validate";
import { isDateString } from "../lib/game/day";
import { REPO_ROOT, c, contentPaths, flagValue, hasFlag, printIssues, readFameCache, readJson, readSources, rel, writeJson } from "./lib/io";

const args = process.argv.slice(2);
const sample = hasFlag(args, "sample");
const paths = contentPaths(sample);
const src = readSources(paths);

const validation = validateSource({ prompts: src.prompts, schedule: src.schedule });
const errors = [...src.parseIssues, ...validation.errors];
if (errors.length || !validation.schedule) {
  printIssues(errors, { warnings: false });
  console.error(c.red(`\nAborting: ${errors.length} validation errors. Run pnpm content:check${sample ? " --sample" : ""} for details.`));
  process.exit(1);
}

const epochOverride = flagValue(args, "epoch") ?? (sample ? undefined : envValue("BARRICADE_EPOCH", REPO_ROOT));
if (epochOverride !== undefined && !isDateString(epochOverride)) {
  console.error(c.red(`Invalid epoch override "${epochOverride}" (want YYYY-MM-DD)`));
  process.exit(1);
}

let fame = null;
try {
  fame = readFameCache(paths.fameCachePath);
} catch (e) {
  console.warn(c.yellow(`warning: ${(e as Error).message} — building without fame`));
}
if (!fame) {
  console.warn(
    c.yellow(`warning: no fame cache at ${rel(paths.fameCachePath)} — rarity uses guesses only. Run pnpm content:fame${sample ? " --sample" : ""}.`),
  );
}

const { pack, report } = compile({
  prompts: validation.prompts,
  schedule: validation.schedule,
  fame,
  kind: sample ? "sample" : "production",
  generatedAt: new Date().toISOString(),
  epochOverride,
});

// Don't churn committed files when nothing but the timestamp changed.
const sameAs = (path: string, next: { generatedAt: string }) => {
  if (!existsSync(path)) return false;
  try {
    const prev = readJson<{ generatedAt: string }>(path);
    return JSON.stringify({ ...prev, generatedAt: "" }) === JSON.stringify({ ...next, generatedAt: "" });
  } catch {
    return false;
  }
};
const unchanged = sameAs(paths.packPath, pack) && sameAs(paths.reportPath, report);
if (!unchanged) {
  writeJson(paths.packPath, pack satisfies ContentPack, false);
  writeJson(paths.reportPath, report);
}

for (const d of report.days) console.log(d.summary);
const flagged = report.prompts.filter((p) => p.warnings.length);
for (const p of flagged) console.log(c.yellow(`  ! ${p.slug}: ${p.warnings.join("; ")}`));
const t = report.totals;
console.log(
  `\n${t.days} days · ${t.scheduledPrompts}/${t.prompts} prompts scheduled · ${t.answers} answers · ${t.entities} entities ` +
    `(${t.mergedEntities} shared) · ${t.catalogKeys} catalog keys · ${t.droppedKeys} dropped keys · ${t.forcedTiers} forced tiers · ` +
    `${validation.warnings.length} source warnings · epoch ${pack.epoch}`,
);
console.log(
  unchanged
    ? c.dim(`unchanged: ${rel(paths.packPath)}`)
    : c.green(`wrote ${rel(paths.packPath)} + ${rel(paths.reportPath)}`),
);
