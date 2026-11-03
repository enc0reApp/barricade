import type { FameCache, FameEntry } from "../../lib/content/fame";
import type { EntityType, SourceAnswer, SourceGuess, SourcePrompt, SourceSchedule } from "../../lib/content/types";

export function answer(name: string, guess: SourceGuess = "tent", extra: Partial<SourceAnswer> = {}): SourceAnswer {
  return { name, type: "festival", wiki: null, guess, ...extra };
}

/** A well-formed prompt with `n` filler answers (2 main, 2 side, rest spread rarer). */
export function prompt(slug: string, extra: Partial<SourcePrompt> = {}, n = 30, type: EntityType = "festival"): SourcePrompt {
  const guesses: SourceGuess[] = ["main", "main", "side", "side", "tent", "tent", "basement", "basement", "htbt"];
  const answers: SourceAnswer[] = Array.from({ length: n }, (_, i) => ({
    name: `${slug} answer ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`,
    type,
    wiki: `Wiki ${slug} ${i}`,
    guess: guesses[i % guesses.length]!,
  }));
  return {
    slug,
    text: `Name a thing for ${slug}`,
    types: [type],
    difficulty: 2,
    boundary: "Anything in the fixture.",
    answers,
    sources: ["https://example.org"],
    ...extra,
  };
}

export function schedule(days: string[][], epoch = "2026-01-01"): SourceSchedule {
  return { epoch, days: days.map((prompts, i) => ({ number: i + 1, prompts })) };
}

export function fameCache(entries: Record<string, Partial<FameEntry> & { views: number }>): FameCache {
  const out: FameCache = { fetchedAt: "2026-11-01T00:00:00.000Z", entries: {} };
  for (const [k, v] of Object.entries(entries)) {
    out.entries[k] = { canonical: v.canonical === undefined ? k : v.canonical, missing: v.missing ?? false, views: v.views };
    if (v.disambiguation) out.entries[k]!.disambiguation = true;
  }
  return out;
}
