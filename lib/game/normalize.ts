/**
 * Answer normalisation + fuzzy matching primitives.
 *
 * SHARED CONTRACT: the content compiler builds alias keys with `matchKeys`,
 * and the runtime matcher looks typed answers up with the same function.
 * If you change anything here, recompile content (pnpm content:build) —
 * a compiled pack records NORMALIZE_VERSION and the loader refuses a mismatch.
 */

/**
 * v2: a "!" that ends a word is punctuation, not an "i" (Wham! → wham,
 * Panic! at the Disco → panic at the disco). P!nk → pink is unchanged.
 */
export const NORMALIZE_VERSION = 2;

const NUMBER_WORDS: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
};

/** Characters people type in place of letters inside names (A$AP, Ke$ha, P!nk, deadmau5 stays). */
const LEET: Record<string, string> = { $: "s", "!": "i", "@": "a" };

/**
 * Loose display-insensitive form:
 *  - Unicode NFKD, diacritics stripped (Björk → bjork, Sigur Rós → sigur ros)
 *  - lowercase
 *  - curly quotes/dashes folded, "&" and "+" → " and "
 *  - a "!" that ends a word is dropped (Wham! → wham, Splash! → splash)
 *  - $ ! @ inside words → s i a (A$AP → asap, P!nk → pink)
 *  - every other non-alphanumeric → space, collapsed
 *  - leading "the " dropped ("The Warehouse Project" ≡ "Warehouse Project")
 */
export function normalize(input: string): string {
  let s = input.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  s = s.toLowerCase();
  s = s.replace(/[‘’ʼ`´]/g, "'").replace(/[“”]/g, '"');
  s = s.replace(/ß/g, "ss").replace(/æ/g, "ae").replace(/ø/g, "o").replace(/đ/g, "d").replace(/ł/g, "l");
  s = s.replace(/\s*[&+]\s*/g, " and ");
  // A "!" run with no letter/digit after it ends a word: punctuation, never an "i".
  s = s.replace(/!+(?![!a-z0-9])/g, " ");
  // Leet characters only when glued to letters on at least one side.
  s = s.replace(/([a-z0-9])([$!@])|([$!@])([a-z0-9])/g, (_m, a, b, c, d) =>
    a !== undefined ? a + LEET[b as string] : LEET[c as string] + d,
  );
  s = s.replace(/'/g, ""); // don't → dont, Guns N' Roses → guns n roses
  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  s = s.replace(/^the /, "");
  return s;
}

/** Spaces removed — "d and b" ≡ "dandb", "boiler room" ≡ "boilerroom". */
export function compact(normalized: string): string {
  return normalized.replace(/ /g, "");
}

/** Number words folded to digits — "blink one eight two" ≡ "blink 182". */
export function foldNumbers(normalized: string): string {
  return normalized
    .split(" ")
    .map((w) => NUMBER_WORDS[w] ?? w)
    .join(" ");
}

/**
 * All lookup keys for a string. Compiler stores every key of every alias;
 * runtime tries every key of the typed answer. Keys are compact (no spaces)
 * so word-boundary differences never matter.
 */
export function matchKeys(input: string): string[] {
  const n = normalize(input);
  if (!n) return [];
  const keys = new Set<string>();
  keys.add(compact(n));
  keys.add(compact(foldNumbers(n)));
  // "and" is often dropped or swapped for "n": "drum and bass" / "drum n bass" / "drum bass"
  keys.add(compact(n.replace(/\b(and|n)\b/g, " ")));
  return [...keys].filter(Boolean);
}

/** The primary key — what the fuzzy matcher compares. */
export function primaryKey(input: string): string {
  return compact(foldNumbers(normalize(input)));
}

/**
 * Optimal-string-alignment Damerau–Levenshtein distance with an early-exit
 * ceiling. Returns `max + 1` as soon as the distance must exceed `max`.
 */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev2 = new Array<number>(lb + 1).fill(0);
  let prev = new Array<number>(lb + 1);
  let cur = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0]!;
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2]! + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[lb]!;
}

/**
 * How many typos we forgive for a key of this length.
 * Short names must be exact — "Muse" vs "Mise" would be a different answer.
 */
export function typoBudget(keyLength: number): number {
  if (keyLength <= 4) return 0;
  if (keyLength <= 7) return 1;
  if (keyLength <= 14) return 2;
  return 3;
}
