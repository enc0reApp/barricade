/**
 * Fame signal: 12 months of English Wikipedia pageviews per answer article.
 *
 * Offline tooling only (scripts/fetch-fame.ts). The compiler reads the cache
 * through `fameFor` and never touches the network.
 *
 *   1. resolveTitles — batches of 50 through the MediaWiki query API, following
 *      normalisation and redirects, so every source title maps to its canonical
 *      article (or is flagged missing — the hallucination detector).
 *   2. fetchMonthlyViews — per canonical article, mean monthly user views over
 *      the last 12 complete months (404 = no views = 0).
 */

export const FAME_USER_AGENT = "barricade-content/0.1 (https://fstvl.xyz)";
export const FAME_MAX_AGE_DAYS = 30;
export const FAME_MONTHS = 12;
const TITLE_BATCH = 50;

export interface FameEntry {
  /** Canonical article title after normalisation + redirects; null when missing. */
  canonical: string | null;
  missing: boolean;
  /** Mean monthly user pageviews over the window (0 when missing / no data). */
  views: number;
  /** The resolved article is a disambiguation page (almost always an authoring mistake). */
  disambiguation?: boolean;
  /** When this entry was fetched (ISO). Falls back to the cache's fetchedAt. */
  fetchedAt?: string;
}

export interface FameCache {
  fetchedAt: string;
  /** Window the views cover, e.g. "202511–202610". */
  window?: string;
  /** Keyed by `wikiKey(title)`. */
  entries: Record<string, FameEntry>;
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  headers?: { get(name: string): string | null };
}>;

/**
 * Cache key for a wiki title: underscores → spaces, whitespace collapsed,
 * first letter upper-cased (MediaWiki titles are first-letter case-insensitive).
 */
export function wikiKey(title: string): string {
  const t = title.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** Look a source title up in a cache. */
export function fameFor(cache: FameCache | null | undefined, title: string | null | undefined): FameEntry | null {
  if (!cache || !title) return null;
  return cache.entries[wikiKey(title)] ?? null;
}

export function isFresh(entry: FameEntry, cache: FameCache, nowMs: number, maxAgeDays = FAME_MAX_AGE_DAYS): boolean {
  const at = Date.parse(entry.fetchedAt ?? cache.fetchedAt);
  return Number.isFinite(at) && nowMs - at < maxAgeDays * 86_400_000;
}

/** The last `months` complete calendar months before `now`, as pageview API bounds. */
export function pageviewWindow(now: Date, months = FAME_MONTHS): { start: string; end: string; label: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // current (incomplete) month, 0-based
  const endD = new Date(Date.UTC(y, m - 1, 1));
  const startD = new Date(Date.UTC(y, m - months, 1));
  const fmt = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}01`;
  const start = fmt(startD);
  const end = fmt(endD);
  return { start, end, label: `${start.slice(0, 6)}–${end.slice(0, 6)}` };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Shared back-off: when any request is throttled (429), every worker waits
 * until the gate reopens instead of hammering the API in parallel.
 */
export class RateGate {
  private openAt = 0;
  async wait(): Promise<void> {
    for (;;) {
      const ms = this.openAt - Date.now();
      if (ms <= 0) return;
      await sleep(ms);
    }
  }
  close(ms: number): void {
    this.openAt = Math.max(this.openAt, Date.now() + ms);
  }
}

interface GetOptions {
  fetchImpl: FetchLike;
  retries?: number;
  baseDelayMs?: number;
  /** Ceiling for one back-off wait. */
  maxDelayMs?: number;
  gate?: RateGate;
}

function retryAfterMs(h: string | null | undefined): number | null {
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/** GET JSON with retries on 429/5xx/network errors. Returns null on 404. */
async function getJson(url: string, opts: GetOptions): Promise<unknown | null> {
  const retries = opts.retries ?? 8;
  const base = opts.baseDelayMs ?? 1000;
  const maxDelay = opts.maxDelayMs ?? 60_000;
  for (let attempt = 0; ; attempt++) {
    await opts.gate?.wait();
    let status = 0;
    let retryAfter: number | null = null;
    try {
      const res = await opts.fetchImpl(url, { headers: { "User-Agent": FAME_USER_AGENT, Accept: "application/json" } });
      status = res.status;
      if (res.ok) return await res.json();
      if (status === 404) return null;
      if (status !== 429 && status < 500) throw new Error(`HTTP ${status} for ${url}`);
      retryAfter = retryAfterMs(res.headers?.get("retry-after"));
    } catch (e) {
      if (status && status !== 429 && status < 500) throw e;
      if (attempt >= retries) throw e;
    }
    if (attempt >= retries) throw new Error(`HTTP ${status} after ${retries + 1} attempts for ${url}`);
    const delay = Math.min(maxDelay, retryAfter ?? base * 2 ** attempt) + Math.floor(Math.random() * 250);
    if (status === 429) opts.gate?.close(delay);
    await sleep(delay);
  }
}

/** Run `fn` over items with at most `limit` in flight. Results keep input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export interface ResolvedTitle {
  canonical: string | null;
  missing: boolean;
  disambiguation: boolean;
}

interface QueryResponse {
  query?: {
    normalized?: { from: string; to: string }[];
    redirects?: { from: string; to: string }[];
    pages?: { title: string; missing?: boolean; invalid?: boolean; pageprops?: Record<string, unknown> }[];
  };
}

/**
 * Resolve titles (any spelling; keys from `wikiKey`) to canonical article
 * titles, 50 per request, following normalisation and redirect chains.
 */
export async function resolveTitles(
  titles: readonly string[],
  opts: GetOptions & { onBatch?: (done: number, total: number) => void },
): Promise<Map<string, ResolvedTitle>> {
  const out = new Map<string, ResolvedTitle>();
  const unique = [...new Set(titles.map(wikiKey).filter(Boolean))];
  for (let i = 0; i < unique.length; i += TITLE_BATCH) {
    const batch = unique.slice(i, i + TITLE_BATCH);
    const url =
      "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1" +
      "&prop=pageprops&ppprop=disambiguation&titles=" +
      encodeURIComponent(batch.join("|"));
    const data = ((await getJson(url, opts)) ?? {}) as QueryResponse;
    const norm = new Map((data.query?.normalized ?? []).map((n) => [n.from, n.to]));
    const redir = new Map((data.query?.redirects ?? []).map((r) => [r.from, r.to]));
    const pages = new Map((data.query?.pages ?? []).map((p) => [p.title, p]));
    for (const t of batch) {
      let cur = norm.get(t) ?? t;
      const seen = new Set<string>();
      while (redir.has(cur) && !seen.has(cur)) {
        seen.add(cur);
        cur = redir.get(cur)!;
      }
      const page = pages.get(cur);
      if (!page || page.missing || page.invalid) {
        out.set(t, { canonical: null, missing: true, disambiguation: false });
      } else {
        out.set(t, {
          canonical: page.title,
          missing: false,
          disambiguation: !!page.pageprops && "disambiguation" in page.pageprops,
        });
      }
    }
    opts.onBatch?.(Math.min(i + TITLE_BATCH, unique.length), unique.length);
  }
  return out;
}

interface PageviewsResponse {
  items?: { views?: number }[];
}

/** Mean monthly user views for one canonical article over the window (404 → 0). */
export async function fetchMonthlyViews(
  canonical: string,
  window: { start: string; end: string },
  opts: GetOptions & { months?: number },
): Promise<number> {
  const article = encodeURIComponent(canonical.replace(/ /g, "_"));
  const url =
    "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/" +
    `${article}/monthly/${window.start}/${window.end}`;
  const data = (await getJson(url, opts)) as PageviewsResponse | null;
  if (!data) return 0;
  const total = (data.items ?? []).reduce((s, it) => s + (typeof it.views === "number" ? it.views : 0), 0);
  // Months with no views are omitted by the API, so divide by the window, not the item count.
  return Math.round(total / (opts.months ?? FAME_MONTHS));
}

export interface FetchFameOptions {
  fetchImpl?: FetchLike;
  now?: Date;
  /** Ignore cache freshness and refetch everything. */
  refresh?: boolean;
  concurrency?: number;
  retries?: number;
  baseDelayMs?: number;
  /** Drop cache entries for titles no longer referenced. Default true. */
  prune?: boolean;
  log?: (msg: string) => void;
  /** Called with the cache so far every `checkpointEvery` fetched articles (write it to disk to resume later). */
  onCheckpoint?: (cache: FameCache) => void;
  checkpointEvery?: number;
}

export interface FetchFameResult {
  cache: FameCache;
  fetched: number;
  reused: number;
  pruned: number;
  /** Titles that could not be fetched (left out of the cache so the next run retries them). */
  failed: { title: string; error: string }[];
}

/**
 * Bring a cache up to date for `titles`. Fresh entries are reused; stale or
 * absent ones are resolved and their views fetched (once per canonical title).
 */
export async function updateFameCache(
  titles: readonly string[],
  previous: FameCache | null,
  options: FetchFameOptions = {},
): Promise<FetchFameResult> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const log = options.log ?? (() => {});
  const get: GetOptions = {
    fetchImpl,
    retries: options.retries,
    baseDelayMs: options.baseDelayMs,
    gate: new RateGate(),
  };
  const window = pageviewWindow(now);

  const wanted = [...new Set(titles.map(wikiKey).filter(Boolean))];
  const entries: Record<string, FameEntry> = {};
  const todo: string[] = [];
  const failed: FetchFameResult["failed"] = [];
  let reused = 0;
  for (const t of wanted) {
    const prev = previous?.entries[t];
    if (prev && previous && !options.refresh && isFresh(prev, previous, now.getTime())) {
      entries[t] = { ...prev, fetchedAt: prev.fetchedAt ?? previous.fetchedAt };
      reused++;
    } else todo.push(t);
  }

  const snapshot = (): FameCache => {
    const all: Record<string, FameEntry> = { ...entries };
    // Until this run finishes, keep stale entries we haven't replaced yet.
    if (previous) for (const [k, v] of Object.entries(previous.entries)) if (!(k in all)) all[k] = v;
    const sorted: Record<string, FameEntry> = {};
    for (const k of Object.keys(all).sort()) sorted[k] = all[k]!;
    return { fetchedAt: nowIso, window: window.label, entries: sorted };
  };

  let fetched = 0;
  if (todo.length) {
    log(`resolving ${todo.length} titles…`);
    const resolved = await resolveTitles(todo, { ...get, onBatch: (d, n) => log(`  resolved ${d}/${n}`) });
    const byCanonical = new Map<string, string[]>();
    for (const t of todo) {
      const r = resolved.get(t) ?? { canonical: null, missing: true, disambiguation: false };
      if (r.missing || !r.canonical) {
        entries[t] = { canonical: null, missing: true, views: 0, fetchedAt: nowIso };
        fetched++;
      } else byCanonical.set(r.canonical, [...(byCanonical.get(r.canonical) ?? []), t]);
    }
    const canonicals = [...byCanonical.keys()];
    log(`fetching pageviews for ${canonicals.length} articles (${window.label})…`);
    const every = options.checkpointEvery ?? 200;
    let done = 0;
    await mapLimit(canonicals, options.concurrency ?? 8, async (c) => {
      try {
        const v = await fetchMonthlyViews(c, window, get);
        for (const t of byCanonical.get(c)!) {
          const e: FameEntry = { canonical: c, missing: false, views: v, fetchedAt: nowIso };
          if (resolved.get(t)?.disambiguation) e.disambiguation = true;
          entries[t] = e;
          fetched++;
        }
      } catch (err) {
        for (const t of byCanonical.get(c)!) failed.push({ title: t, error: (err as Error).message });
      }
      done++;
      if (done % 50 === 0 || done === canonicals.length) log(`  pageviews ${done}/${canonicals.length}`);
      if (options.onCheckpoint && done % every === 0) options.onCheckpoint(snapshot());
    });
  }

  // Keep unreferenced entries unless pruning.
  let pruned = 0;
  if (previous) {
    const failedTitles = new Set(failed.map((f) => f.title));
    for (const [k, v] of Object.entries(previous.entries)) {
      if (k in entries || failedTitles.has(k)) continue;
      if (options.prune === false) entries[k] = v;
      else pruned++;
    }
  }

  const sorted: Record<string, FameEntry> = {};
  for (const k of Object.keys(entries).sort()) sorted[k] = entries[k]!;
  // A failed title keeps its previous (stale) entry, if any, so a flaky run never loses data.
  for (const f of failed) {
    const prev = previous?.entries[f.title];
    if (prev && !(f.title in sorted)) sorted[f.title] = prev;
  }
  const out: Record<string, FameEntry> = {};
  for (const k of Object.keys(sorted).sort()) out[k] = sorted[k]!;
  return {
    cache: { fetchedAt: todo.length || !previous ? nowIso : previous.fetchedAt, window: window.label, entries: out },
    fetched,
    reused,
    pruned,
    failed,
  };
}
