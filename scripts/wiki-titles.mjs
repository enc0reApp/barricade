#!/usr/bin/env node
/**
 * Quick authoring helper: check that every `wiki` title in one or more
 * SourcePrompt files is a real, non-disambiguation English Wikipedia article.
 *
 *   node scripts/wiki-titles.mjs content/source/prompts/uk-festivals.json [...more]
 *
 * Prints MISSING / DISAMBIG / REDIRECT lines and exits 1 if anything is wrong.
 * No dependencies. Batches 50 titles per request.
 */
import { readFileSync } from "node:fs";

const UA = "barricade-content/0.1 (https://fstvl.xyz)";
const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node scripts/wiki-titles.mjs <prompt.json> [...]");
  process.exit(2);
}

/** @type {Map<string, {file: string, name: string}[]>} */
const byTitle = new Map();
for (const f of files) {
  let json;
  try {
    json = JSON.parse(readFileSync(f, "utf8"));
  } catch (e) {
    console.error(`BADJSON  ${f}: ${e.message}`);
    process.exitCode = 1;
    continue;
  }
  for (const a of json.answers ?? []) {
    if (!a.wiki) continue;
    const t = String(a.wiki).replace(/_/g, " ").trim();
    if (!byTitle.has(t)) byTitle.set(t, []);
    byTitle.get(t).push({ file: f, name: a.name });
  }
}

const titles = [...byTitle.keys()];
let bad = 0;
let redirects = 0;

async function query(batch, attempt = 0) {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=pageprops&ppprop=disambiguation&titles=" +
    encodeURIComponent(batch.join("|"));
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    return query(batch, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

for (let i = 0; i < titles.length; i += 50) {
  const batch = titles.slice(i, i + 50);
  const data = await query(batch);
  const norm = new Map((data.query?.normalized ?? []).map((n) => [n.from, n.to]));
  const redir = new Map((data.query?.redirects ?? []).map((r) => [r.from, r.to]));
  const pages = new Map((data.query?.pages ?? []).map((p) => [p.title, p]));
  for (const t of batch) {
    const n = norm.get(t) ?? t;
    const r = redir.get(n) ?? n;
    const page = pages.get(r);
    const who = byTitle
      .get(t)
      .map((x) => `${x.name} (${x.file.split("/").pop()})`)
      .join(", ");
    if (!page || page.missing || page.invalid) {
      bad++;
      console.log(`MISSING   "${t}"  ← ${who}`);
    } else if (page.pageprops && "disambiguation" in page.pageprops) {
      bad++;
      console.log(`DISAMBIG  "${t}" → "${r}"  ← ${who}`);
    } else if (r !== n) {
      redirects++;
      if (process.env.SHOW_REDIRECTS) console.log(`REDIRECT  "${t}" → "${r}"`);
    }
  }
}

console.log(`\n${titles.length} titles checked · ${bad} problems · ${redirects} redirects (fine)`);
if (bad) process.exitCode = 1;
