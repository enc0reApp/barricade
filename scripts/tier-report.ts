/**
 * Pretty-print the tier report written by build-content.
 *
 *   pnpm content:report                 # content/build/report.json
 *   pnpm content:report --sample        # content/sample/report.json
 *   pnpm content:report --prompt <slug> # one prompt, in full
 *   pnpm content:report --all           # include unscheduled prompts
 *   pnpm content:report --flagged       # only prompts with warnings
 */

import { existsSync } from "node:fs";
import type { CompileReport, PromptReport } from "../lib/content/compile";
import { TIERS, TIER_IDS, type TierId } from "../lib/game/tiers";
import { c, contentPaths, flagValue, hasFlag, readJson, rel } from "./lib/io";

const args = process.argv.slice(2);
const sample = hasFlag(args, "sample");
const paths = contentPaths(sample);
if (!existsSync(paths.reportPath)) {
  console.error(c.red(`No report at ${rel(paths.reportPath)}. Run pnpm content:${sample ? "sample" : "build"} first.`));
  process.exit(1);
}
const report = readJson<CompileReport>(paths.reportPath);
const only = flagValue(args, "prompt");
const flaggedOnly = hasFlag(args, "flagged");

const tierColor: Record<TierId, (s: string) => string> = {
  main: (s) => s,
  tote: c.magenta,
  side: c.cyan,
  tent: c.green,
  basement: c.magenta,
  htbt: c.yellow,
};
const pct = (x: number) => (x >= 0.01 ? `${(x * 100).toFixed(1)}%` : `${(x * 100).toFixed(2)}%`);

function bar(p: PromptReport): string {
  const width = 42;
  const parts: string[] = [];
  for (const t of TIER_IDS) {
    const n = p.tiers[t];
    if (!n) continue;
    const w = Math.max(1, Math.round((n / p.answers) * width));
    parts.push(tierColor[t](TIERS[t].code.toUpperCase().repeat(w)));
  }
  return parts.join("");
}

function printPrompt(p: PromptReport, full: boolean): void {
  const head = `${c.bold(p.slug)}  "${p.text}"  ${c.dim(`d${p.difficulty} · ${p.primaryType} · ${p.rarity} · fame ${p.withFame}/${p.answers}`)}`;
  console.log(`  ${p.warnings.length ? c.yellow("!") : " "} ${head}`);
  console.log(`      ${bar(p)}  ${TIER_IDS.map((t) => `${TIERS[t].code.toUpperCase()}${p.tiers[t]}`).join(" ")}`);
  console.log(`      top: ${p.top.map((x) => `${x.name} ${c.dim(pct(x.share))}`).join(", ")}`);
  if (p.flags.length) console.log(`      flags: ${p.flags.map((f) => `${f.name}=${f.flag}`).join(", ")}`);
  for (const w of p.warnings) console.log(`      ${c.yellow(`! ${w}`)}`);
  const drifts = full ? p.drifts : p.drifts.slice(0, 6);
  if (drifts.length) {
    console.log(
      `      drift: ${drifts.map((d) => `${d.name} ${d.guess}→${d.tier}${d.views !== null ? c.dim(` (${d.views}/mo)`) : ""}`).join(", ")}` +
        (p.drifts.length > drifts.length ? c.dim(` …+${p.drifts.length - drifts.length}`) : ""),
    );
  }
  if (p.forced.length) console.log(`      forced: ${p.forced.map((f) => `${f.name} ${f.from}→${f.to}`).join(", ")}`);
  if (p.droppedKeys.length) {
    const ks = full ? p.droppedKeys : p.droppedKeys.slice(0, 6);
    console.log(
      `      dropped keys: ${ks
        .map((k) => `${k.key} (${k.droppedFrom.join("/")}${k.keptBy.length ? ` kept by ${k.keptBy.join("/")}` : ""})`)
        .join(", ")}` + (p.droppedKeys.length > ks.length ? c.dim(` …+${p.droppedKeys.length - ks.length}`) : ""),
    );
  }
}

const bySlug = new Map(report.prompts.map((p) => [p.slug, p]));
console.log(
  c.bold(`BARRICADE ${report.kind} pack · epoch ${report.epoch} · generated ${report.generatedAt}`) +
    c.dim(` · fame entries ${report.fame.entries}${report.fame.fetchedAt ? ` (${report.fame.fetchedAt.slice(0, 10)})` : ""}`),
);

if (only) {
  const p = bySlug.get(only);
  if (!p) {
    console.error(c.red(`No prompt "${only}" in the report`));
    process.exit(1);
  }
  printPrompt(p, true);
  process.exit(0);
}

for (const d of report.days) {
  const ps = d.prompts.map((s) => bySlug.get(s)).filter((p): p is PromptReport => !!p);
  if (flaggedOnly && !ps.some((p) => p.warnings.length)) continue;
  console.log(`\n${c.bold(d.summary)}`);
  for (const p of ps) if (!flaggedOnly || p.warnings.length) printPrompt(p, false);
}

if (hasFlag(args, "all")) {
  const unscheduled = report.prompts.filter((p) => !p.days.length && (!flaggedOnly || p.warnings.length));
  if (unscheduled.length) {
    console.log(`\n${c.bold(`Unscheduled (${unscheduled.length})`)}`);
    for (const p of unscheduled) printPrompt(p, false);
  }
}

const t = report.totals;
console.log(
  `\n${t.days} days · ${t.prompts} prompts · ${t.answers} answers · ${t.promptsWithWarnings} prompts flagged · ` +
    `${t.forcedTiers} forced tiers · ${t.droppedKeys} dropped keys · ${report.idCollisions.length} id collisions`,
);
