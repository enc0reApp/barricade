/** Compile and seal one isolated edition without touching the daily schedule.
 * pnpm exec tsx scripts/build-exclusive.ts <edition-slug>
 * Sources live in gitignored content/source/special/<edition-slug>/.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { START_DISTANCE } from "../lib/game/tiers";
import { compile } from "../lib/content/compile";
import { validateSource } from "../lib/content/validate";
import { audienceIssues } from "../lib/content/audience";
import { envValue } from "../lib/content/env";
import { seal, unseal } from "../lib/content/seal";
import { buildCatalogIndex, buildPromptIndex, matchAnswer } from "../lib/game/match";
import { collectBundle } from "./lib/bundle";

const edition = process.argv[2];
if (!edition || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(edition)) throw new Error("Provide an edition slug");
const root = resolve(import.meta.dirname, "..");
const source = join(root, "content/source/special", edition);
const prompts = readdirSync(join(source, "prompts")).filter((f) => f.endsWith(".json")).sort().map((f) => ({
  file: `prompts/${f}`, data: JSON.parse(readFileSync(join(source, "prompts", f), "utf8")),
}));
const result = validateSource({ prompts, schedule: { file: "schedule.json", data: JSON.parse(readFileSync(join(source, "schedule.json"), "utf8")) } });
const errors = [...result.errors, ...audienceIssues(result.prompts, result.schedule)];
if (errors.length || !result.schedule) throw new Error(errors.map((e) => `${e.file}: ${e.message}`).join("\n"));
const { pack } = compile({ prompts: result.prompts, schedule: result.schedule, fame: null, kind: "production", generatedAt: new Date().toISOString() });
const catalog = buildCatalogIndex(pack.catalog);
for (const puzzle of pack.puzzles) for (const prompt of puzzle.prompts) {
  const indexes = { prompt: buildPromptIndex(prompt), catalog };
  if (!prompt.answers.some((a) => a.tier === "htbt")) throw new Error(`${prompt.id}: no 100-point answer`);
  for (const a of prompt.answers) {
    const match = matchAnswer(prompt, a.name, indexes);
    if (match.kind !== "accepted" || match.answer.id !== a.id) throw new Error(`${prompt.id}: canonical answer does not match itself`);
  }
}
const key = envValue("BARRICADE_SEAL_KEY", root);
if (!key) throw new Error("BARRICADE_SEAL_KEY is required");
const outputs = [
  { name: `${edition}.json.enc`, label: "pack", text: JSON.stringify(pack) },
  { name: `${edition}-source.json.enc`, label: "source", text: JSON.stringify(collectBundle(source)) },
];
mkdirSync(join(root, "content/sealed"), { recursive: true });
for (const o of outputs) {
  const encrypted = seal(o.text, key, o.label);
  if (unseal(encrypted, key) !== o.text) throw new Error("Encryption round-trip failed");
  writeFileSync(join(root, "content/sealed", o.name), JSON.stringify(encrypted) + "\n");
}
console.log(`Sealed ${edition}: ${pack.puzzles.length} set, ${result.prompts.length} prompts, ${result.prompts.reduce((n, p) => n + p.answers.length, 0)} answers. Canonical matching and ${START_DISTANCE}-point reachability verified. ${result.warnings.length} editorial warnings.`);
