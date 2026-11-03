/**
 * Fetch/refresh Wikipedia fame (12 complete months of pageviews) for every
 * wiki title in the sources.
 *
 *   pnpm content:fame               # content/source → content/source/.cache/fame.json
 *   pnpm content:fame --sample      # content/sample/source → content/sample/.cache/fame.json
 *   pnpm content:fame --refresh     # ignore the 30-day cache
 *   pnpm content:fame --keep        # keep cache entries no longer referenced
 *   --concurrency N                 # parallel pageview requests (default 8)
 *
 * Prints MISSING / DISAMBIG titles grouped by file — the hallucination detector.
 * Exit 1 when any title is missing or a disambiguation page.
 */

import { fameFor, updateFameCache, wikiKey } from "../lib/content/fame";
import { c, contentPaths, flagValue, hasFlag, readFameCache, readSources, rel, writeJson } from "./lib/io";

const args = process.argv.slice(2);
const paths = contentPaths(hasFlag(args, "sample"));
const src = readSources(paths);
for (const i of src.parseIssues) console.log(c.red(`skip ${i.file}: ${i.message}`));

/** title key → where it's used */
const uses = new Map<string, { file: string; name: string; wiki: string }[]>();
for (const f of src.prompts) {
  const answers = (f.data as { answers?: unknown }).answers;
  if (!Array.isArray(answers)) continue;
  for (const a of answers as { name?: unknown; wiki?: unknown }[]) {
    if (typeof a?.wiki !== "string" || !a.wiki.trim()) continue;
    const k = wikiKey(a.wiki);
    uses.set(k, [...(uses.get(k) ?? []), { file: f.file, name: String(a.name), wiki: a.wiki }]);
  }
}

if (!uses.size) {
  console.log(c.yellow(`No wiki titles found under ${rel(paths.sourceDir)}`));
  process.exit(0);
}

const previous = (() => {
  try {
    return readFameCache(paths.fameCachePath);
  } catch (e) {
    console.log(c.yellow(`ignoring unreadable cache: ${(e as Error).message}`));
    return null;
  }
})();

const started = Date.now();
const concurrency = Number(flagValue(args, "concurrency") ?? 8);
const result = await updateFameCache([...uses.keys()], previous, {
  refresh: hasFlag(args, "refresh"),
  prune: !hasFlag(args, "keep"),
  concurrency: Number.isInteger(concurrency) && concurrency > 0 ? concurrency : 8,
  log: (m) => console.log(c.dim(m)),
  // Save progress so an interrupted or throttled run resumes where it stopped.
  onCheckpoint: (partial) => writeJson(paths.fameCachePath, partial),
});
writeJson(paths.fameCachePath, result.cache);
if (result.failed.length) {
  console.log(c.yellow(`\n${result.failed.length} titles could not be fetched (rerun to retry): ${result.failed.slice(0, 10).map((f) => f.title).join(", ")}${result.failed.length > 10 ? "…" : ""}`));
  console.log(c.dim(`  first error: ${result.failed[0]!.error}`));
}

// Report problems grouped by file.
const problems = new Map<string, string[]>();
let missing = 0;
let disambig = 0;
for (const [k, list] of uses) {
  const e = fameFor(result.cache, k);
  if (!e) continue;
  if (!e.missing && !e.disambiguation) continue;
  if (e.missing) missing++;
  else disambig++;
  for (const u of list) {
    const line = e.missing
      ? `${c.red("MISSING ")}  "${u.wiki}"  ← ${u.name}`
      : `${c.yellow("DISAMBIG")}  "${u.wiki}" → "${e.canonical}"  ← ${u.name}`;
    problems.set(u.file, [...(problems.get(u.file) ?? []), line]);
  }
}
for (const [file, lines] of [...problems].sort(([a], [b]) => (a < b ? -1 : 1))) {
  console.log(c.bold(file));
  for (const l of lines) console.log(`  ${l}`);
}

const zero = Object.values(result.cache.entries).filter((e) => !e.missing && e.views === 0).length;
console.log(
  `\n${uses.size} titles · ${result.fetched} fetched · ${result.reused} reused · ${result.pruned} pruned · ` +
    `${missing ? c.red(`${missing} missing`) : c.green("0 missing")} · ${disambig} disambiguation · ${zero} with 0 views · ` +
    `window ${result.cache.window} · ${((Date.now() - started) / 1000).toFixed(1)}s → ${rel(paths.fameCachePath)}`,
);
if (missing || disambig || result.failed.length) process.exitCode = 1;
