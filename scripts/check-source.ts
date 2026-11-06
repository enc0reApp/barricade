/**
 * Validate content sources.
 *
 *   pnpm content:check              # content/source
 *   pnpm content:check --sample     # content/sample/source
 *   pnpm content:check --errors     # hide warnings
 *
 * Exit 1 when there are errors.
 */

import { audienceIssues } from "../lib/content/audience";
import { validateSource } from "../lib/content/validate";
import { c, contentPaths, hasFlag, printIssues, readSources, rel } from "./lib/io";

const args = process.argv.slice(2);
const paths = contentPaths(hasFlag(args, "sample"));
const src = readSources(paths);

if (!src.prompts.length && !src.parseIssues.length) {
  console.log(c.yellow(`No prompt files in ${rel(paths.promptsDir)}`));
}

const result = validateSource({ prompts: src.prompts, schedule: src.schedule });
const issues = [...src.parseIssues, ...result.issues, ...audienceIssues(result.prompts, result.schedule)];
const [errors, warnings] = printIssues(issues, { warnings: !hasFlag(args, "errors") });

const scheduled = new Set(result.schedule?.days.flatMap((d) => d.prompts) ?? []);
const unscheduled = result.prompts.filter((p) => !scheduled.has(p.slug)).length;
const answers = result.prompts.reduce((s, p) => s + p.answers.length, 0);

console.log(
  `\n${rel(paths.sourceDir)}: ${src.prompts.length} prompt files · ${answers} answers · ` +
    `${result.schedule?.days.length ?? 0} days · ${unscheduled} unscheduled · ` +
    `${errors ? c.red(`${errors} errors`) : c.green("0 errors")} · ${warnings} warnings`,
);
if (errors) process.exitCode = 1;
