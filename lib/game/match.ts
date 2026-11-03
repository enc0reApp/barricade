/**
 * Runtime answer matcher. Pure + isomorphic (no node: imports) so it can be
 * unit-tested directly; the loader builds the indexes once per pack.
 *
 * Order of resolution for one typed answer:
 *   1. empty      — nothing usable typed (no keys). One-character input ("Q",
 *                  "3") is accepted only as the exact NAME of an answer here
 *                  (The Q, 3); anything else that short is empty.
 *   2. exact      — any matchKeys(typed) key is a key of an answer on this prompt.
 *                  After this, a primary key under 2 chars ("Seven" → "7") stops: empty.
 *   3. catalog ⇒ prompt — an exact catalog hit on an entity that IS an answer
 *                  here (aliases written for the same entity in other prompts)
 *   4. fuzzy      — primaryKey(typed) within typoBudget of an answer key that
 *                  starts with the same character, unless the typed text is
 *                  exactly some OTHER real entity (then it's off-prompt, not a
 *                  typo: "Fabrik" ≠ "Fabric"). BASEMENT / YOU HAD TO BE THERE
 *                  answers forgive one edit at most, and only on keys of 6+
 *                  chars: a real non-answer one letter off a deep cut ("Zurich"
 *                  / Aurich, "Bozen" / Bogen) must not score 100.
 *   5. offprompt  — exact catalog hit, else fuzzy catalog hit (distance ≤ 1,
 *                  key ≥ 6, same first character)
 *   6. unknown
 */

import type { PackAnswer, PackCatalogEntry, PackPrompt } from "../content/types";
import { editDistance, matchKeys, primaryKey, typoBudget } from "./normalize";
import type { TierId } from "./tiers";

/** Longest typed answer the matcher looks at. */
export const MAX_TYPED_CHARS = 80;
/** Fuzzy off-prompt detection is deliberately stricter than fuzzy acceptance. */
const OFFPROMPT_FUZZY_MAX_DISTANCE = 1;
const OFFPROMPT_FUZZY_MIN_LENGTH = 6;
const MIN_PRIMARY_KEY_LENGTH = 2;
/** Deep tiers are worth 85–100 points: a typo onto one must be unambiguous. */
const RARE_TIERS: ReadonlySet<TierId> = new Set<TierId>(["basement", "htbt"]);
const RARE_FUZZY_MAX_DISTANCE = 1;
const RARE_FUZZY_MIN_LENGTH = 6;

interface KeyRef<T> {
  key: string;
  item: T;
}

export interface PromptIndex {
  /** key → answers carrying that key (usually one). */
  byKey: Map<string, PackAnswer[]>;
  /** answer id → answer. */
  byId: Map<string, PackAnswer>;
  /** answer id → keys built from the answer's NAME only (used to break shared-alias ties). */
  nameKeys: Map<string, Set<string>>;
  /** key length → every (key, answer) pair of that length. For fuzzy scans. */
  byLength: Map<number, KeyRef<PackAnswer>[]>;
}

export interface CatalogIndex {
  byKey: Map<string, PackCatalogEntry[]>;
  byId: Map<string, PackCatalogEntry>;
  byLength: Map<number, KeyRef<PackCatalogEntry>[]>;
}

export interface MatchIndexes {
  prompt: PromptIndex;
  catalog: CatalogIndex;
}

export type MatchResult =
  | { kind: "accepted"; answer: PackAnswer; typo: boolean }
  | { kind: "offprompt"; entry: PackCatalogEntry }
  | { kind: "unknown" }
  | { kind: "empty" };

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildPromptIndex(prompt: PackPrompt): PromptIndex {
  const byKey = new Map<string, PackAnswer[]>();
  const byId = new Map<string, PackAnswer>();
  const nameKeys = new Map<string, Set<string>>();
  const byLength = new Map<number, KeyRef<PackAnswer>[]>();
  for (const answer of prompt.answers) {
    byId.set(answer.id, answer);
    nameKeys.set(answer.id, new Set(matchKeys(answer.name)));
    for (const key of new Set(answer.keys)) {
      if (!key) continue;
      pushTo(byKey, key, answer);
      pushTo(byLength, key.length, { key, item: answer });
    }
  }
  return { byKey, byId, nameKeys, byLength };
}

export function buildCatalogIndex(catalog: readonly PackCatalogEntry[]): CatalogIndex {
  const byKey = new Map<string, PackCatalogEntry[]>();
  const byId = new Map<string, PackCatalogEntry>();
  const byLength = new Map<number, KeyRef<PackCatalogEntry>[]>();
  for (const entry of catalog) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
    for (const key of new Set(entry.keys)) {
      if (!key) continue;
      pushTo(byKey, key, entry);
      pushTo(byLength, key.length, { key, item: entry });
    }
  }
  return { byKey, byId, byLength };
}

/** Deterministic: higher share first, then id ascending. */
function byShareThenId(a: PackAnswer, b: PackAnswer): number {
  if (b.share !== a.share) return b.share - a.share;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function pickExact(prompt: PromptIndex, keys: readonly string[]): PackAnswer | null {
  // Rank every answer hit by any typed key:
  //   1. one of the typed keys is one of its NAME keys (the alias collision tie-break)
  //   2. hit by an earlier (more literal) typed key
  //   3. higher share, then id
  const ranked = new Map<string, { answer: PackAnswer; nameHit: boolean; keyOrder: number }>();
  keys.forEach((key, keyOrder) => {
    const hits = prompt.byKey.get(key);
    if (!hits) return;
    for (const answer of hits) {
      const nameHit = prompt.nameKeys.get(answer.id)?.has(key) ?? false;
      const prev = ranked.get(answer.id);
      if (!prev) ranked.set(answer.id, { answer, nameHit, keyOrder });
      else if (nameHit && !prev.nameHit) prev.nameHit = true;
    }
  });
  let best: { answer: PackAnswer; nameHit: boolean; keyOrder: number } | null = null;
  for (const cand of ranked.values()) {
    if (!best) {
      best = cand;
      continue;
    }
    if (cand.nameHit !== best.nameHit) {
      if (cand.nameHit) best = cand;
      continue;
    }
    if (cand.keyOrder !== best.keyOrder) {
      if (cand.keyOrder < best.keyOrder) best = cand;
      continue;
    }
    if (byShareThenId(cand.answer, best.answer) < 0) best = cand;
  }
  return best ? best.answer : null;
}

function pickFuzzyAnswer(prompt: PromptIndex, pk: string): PackAnswer | null {
  const maxBudget = typoBudget(pk.length);
  if (maxBudget === 0) return null;
  let best: { answer: PackAnswer; d: number } | null = null;
  for (let len = Math.max(1, pk.length - maxBudget); len <= pk.length + maxBudget; len++) {
    const bucket = prompt.byLength.get(len);
    if (!bucket) continue;
    const lengthBudget = typoBudget(Math.min(pk.length, len));
    if (lengthBudget === 0 || Math.abs(len - pk.length) > lengthBudget) continue;
    for (const { key, item } of bucket) {
      // Anchored: a different first letter is a different word far more often than a typo.
      if (key[0] !== pk[0]) continue;
      let budget = lengthBudget;
      if (RARE_TIERS.has(item.tier)) {
        if (Math.min(pk.length, len) < RARE_FUZZY_MIN_LENGTH) continue;
        budget = Math.min(budget, RARE_FUZZY_MAX_DISTANCE);
        if (Math.abs(len - pk.length) > budget) continue;
      }
      const d = editDistance(pk, key, budget);
      if (d > budget) continue;
      if (!best || d < best.d || (d === best.d && byShareThenId(item, best.answer) < 0)) {
        best = { answer: item, d };
      }
    }
  }
  return best ? best.answer : null;
}

function catalogExactHits(catalog: CatalogIndex, keys: readonly string[]): PackCatalogEntry[] {
  const seen = new Map<string, PackCatalogEntry>();
  for (const key of keys) {
    for (const entry of catalog.byKey.get(key) ?? []) {
      if (!seen.has(entry.id)) seen.set(entry.id, entry);
    }
  }
  return [...seen.values()];
}

/** Most relevant "real thing" to name back: a type this prompt accepts, then a name hit, then id. */
function rankCatalog(
  prompt: PackPrompt,
  keys: readonly string[],
): (a: PackCatalogEntry, b: PackCatalogEntry) => number {
  const typeOk = (e: PackCatalogEntry) => (prompt.types.includes(e.type) ? 0 : 1);
  const nameHit = (e: PackCatalogEntry) => (matchKeys(e.name).some((k) => keys.includes(k)) ? 0 : 1);
  return (a, b) =>
    typeOk(a) - typeOk(b) || nameHit(a) - nameHit(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function pickFuzzyCatalog(catalog: CatalogIndex, pk: string): PackCatalogEntry[] {
  if (pk.length < OFFPROMPT_FUZZY_MIN_LENGTH) return [];
  const max = OFFPROMPT_FUZZY_MAX_DISTANCE;
  let bestD = max + 1;
  let hits: PackCatalogEntry[] = [];
  for (let len = Math.max(OFFPROMPT_FUZZY_MIN_LENGTH, pk.length - max); len <= pk.length + max; len++) {
    for (const { key, item } of catalog.byLength.get(len) ?? []) {
      if (key[0] !== pk[0]) continue;
      const d = editDistance(pk, key, max);
      if (d > max) continue;
      if (d < bestD) {
        bestD = d;
        hits = [item];
      } else if (d === bestD && !hits.some((h) => h.id === item.id)) {
        hits.push(item);
      }
    }
  }
  return hits;
}

/** Trim + cap what we look at. Exported so routes log the same string they matched. */
export function clampTyped(typed: string): string {
  return typed.trim().slice(0, MAX_TYPED_CHARS);
}

export function matchAnswer(prompt: PackPrompt, typed: string, indexes: MatchIndexes): MatchResult {
  const text = clampTyped(typeof typed === "string" ? typed : "");
  // normalize() drops a word-final "!" (NORMALIZE_VERSION 2), so an excited
  // "Muse!" is "muse" and "Splash" matches the compiled "Splash!".
  const keys = matchKeys(text);
  if (keys.length === 0) return { kind: "empty" };

  const { prompt: pIndex, catalog } = indexes;

  // 1. One-character input: only the exact NAME of an answer here (The Q, 3) —
  //    never a derived alias variant ("e" from "e+") and never fuzzy/catalog.
  if (keys.every((k) => k.length < MIN_PRIMARY_KEY_LENGTH)) {
    const hit = pickExact(pIndex, keys);
    if (hit && keys.some((k) => pIndex.nameKeys.get(hit.id)?.has(k))) {
      return { kind: "accepted", answer: hit, typo: false };
    }
    return { kind: "empty" };
  }

  // 2. Exact on this prompt.
  const exact = pickExact(pIndex, keys);
  if (exact) return { kind: "accepted", answer: exact, typo: false };

  // "Seven" folds to "7": past the exact lookup, too short for anything looser.
  const pk = primaryKey(text);
  if (pk.length < MIN_PRIMARY_KEY_LENGTH) return { kind: "empty" };

  // 3. Exact on the catalog, for an entity that is an answer here.
  const catalogHits = catalogExactHits(catalog, keys);
  const onPrompt = catalogHits
    .map((e) => pIndex.byId.get(e.id))
    .filter((a): a is PackAnswer => a !== undefined)
    .sort(byShareThenId);
  if (onPrompt[0]) return { kind: "accepted", answer: onPrompt[0], typo: false };

  // 4. Fuzzy on this prompt — but an exact hit on another real entity wins.
  if (catalogHits.length === 0) {
    const fuzzy = pickFuzzyAnswer(pIndex, pk);
    if (fuzzy) return { kind: "accepted", answer: fuzzy, typo: true };
  }

  // 5. Off-prompt.
  const rank = rankCatalog(prompt, keys);
  if (catalogHits.length > 0) {
    const entry = [...catalogHits].sort(rank)[0]!;
    return { kind: "offprompt", entry };
  }
  const fuzzyCatalog = pickFuzzyCatalog(catalog, pk);
  const fuzzyOnPrompt = fuzzyCatalog
    .map((e) => pIndex.byId.get(e.id))
    .filter((a): a is PackAnswer => a !== undefined)
    .sort(byShareThenId);
  if (fuzzyOnPrompt[0]) return { kind: "accepted", answer: fuzzyOnPrompt[0], typo: true };
  if (fuzzyCatalog.length > 0) {
    return { kind: "offprompt", entry: [...fuzzyCatalog].sort(rank)[0]! };
  }

  return { kind: "unknown" };
}
