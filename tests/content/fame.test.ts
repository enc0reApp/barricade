import { describe, expect, it } from "vitest";
import { pageviewWindow, resolveTitles, updateFameCache, wikiKey, type FetchLike } from "../../lib/content/fame";

function fakeFetch(handler: (url: URL) => { status: number; body?: unknown }): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push(url);
    expect(init?.headers?.["User-Agent"]).toBe("barricade-content/0.1 (https://fstvl.xyz)");
    const r = handler(new URL(url));
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  }) as FetchLike & { calls: string[] };
  f.calls = calls;
  return f;
}

const wikiApi = (url: URL) => {
  const titles = (url.searchParams.get("titles") ?? "").split("|");
  // Simulated MediaWiki: one normalisation, one redirect, one missing page, one disambiguation page.
  const normalized = titles.filter((t) => t === "Rock werchter").map((from) => ({ from, to: "Rock Werchter" }));
  const redirects = titles.includes("Dour (festival)") ? [{ from: "Dour (festival)", to: "Dour Festival" }] : [];
  const landed = titles.map((t) => (t === "Rock werchter" ? "Rock Werchter" : t === "Dour (festival)" ? "Dour Festival" : t));
  const pages = [...new Set(landed)].map((t) =>
    t === "Ghost Fest" ? { title: t, missing: true } : t === "Mercury" ? { title: t, pageprops: { disambiguation: "" } } : { title: t },
  );
  return { status: 200, body: { query: { normalized, redirects, pages } } };
};

describe("fame", () => {
  it("normalises title keys", () => {
    expect(wikiKey("rock_Werchter ")).toBe("Rock Werchter");
    expect(wikiKey("Dour  (festival)")).toBe("Dour (festival)");
  });

  it("computes the last 12 complete months", () => {
    expect(pageviewWindow(new Date("2026-11-02T10:00:00Z"))).toEqual({ start: "20251101", end: "20261001", label: "202511–202610" });
    expect(pageviewWindow(new Date("2026-01-15T00:00:00Z"))).toMatchObject({ start: "20250101", end: "20251201" });
  });

  it("resolves normalisation, redirects, missing and disambiguation", async () => {
    const f = fakeFetch(wikiApi);
    const r = await resolveTitles(["rock_werchter", "Dour (festival)", "Ghost Fest", "Mercury"], { fetchImpl: f });
    expect(f.calls).toHaveLength(1);
    expect(r.get("Rock werchter")).toEqual({ canonical: "Rock Werchter", missing: false, disambiguation: false });
    expect(r.get("Dour (festival)")).toEqual({ canonical: "Dour Festival", missing: false, disambiguation: false });
    expect(r.get("Ghost Fest")).toEqual({ canonical: null, missing: true, disambiguation: false });
    expect(r.get("Mercury")).toEqual({ canonical: "Mercury", missing: false, disambiguation: true });
  });

  it("batches 50 titles per request", async () => {
    const f = fakeFetch(wikiApi);
    const titles = Array.from({ length: 120 }, (_, i) => `Title ${i}`);
    const r = await resolveTitles(titles, { fetchImpl: f });
    expect(f.calls).toHaveLength(3);
    expect(r.size).toBe(120);
  });

  it("fetches views once per canonical, mean over 12 months, 404 → 0, retries 429", async () => {
    let throttled = false;
    const f = fakeFetch((url) => {
      if (url.hostname === "en.wikipedia.org") return wikiApi(url);
      const parts = url.pathname.split("/");
      const article = decodeURIComponent(parts[parts.indexOf("user") + 1] ?? "");
      if (article === "Dour_Festival" && !throttled) {
        throttled = true;
        return { status: 429 };
      }
      if (article === "Mercury") return { status: 404 };
      return { status: 200, body: { items: [{ views: 1200 }, { views: 1200 }] } };
    });
    const { cache, fetched, reused } = await updateFameCache(
      ["Rock_werchter", "Dour Festival", "Dour (festival)", "Ghost Fest", "Mercury"],
      null,
      { fetchImpl: f, now: new Date("2026-11-02T00:00:00Z"), baseDelayMs: 1 },
    );
    expect(fetched).toBe(5);
    expect(reused).toBe(0);
    expect(cache.entries["Rock werchter"]).toMatchObject({ canonical: "Rock Werchter", missing: false, views: 200 });
    expect(cache.entries["Dour (festival)"]).toMatchObject({ canonical: "Dour Festival", views: 200 });
    expect(cache.entries["Ghost Fest"]).toMatchObject({ canonical: null, missing: true, views: 0 });
    expect(cache.entries["Mercury"]).toMatchObject({ views: 0, disambiguation: true });
    const pv = f.calls.filter((u) => u.includes("pageviews"));
    // Dour Festival fetched once for two source titles (+1 retry).
    expect(pv.filter((u) => u.includes("Dour_Festival"))).toHaveLength(2);
    expect(pv[0]).toContain("/monthly/20251101/20261001");
  });

  it("honours Retry-After on 429 and keeps going when one title keeps failing", async () => {
    let calls = 0;
    const f = (async (url: string) => {
      const u = new URL(url);
      if (u.hostname === "en.wikipedia.org") return { ok: true, status: 200, json: async () => wikiApi(u).body };
      calls++;
      if (url.includes("/Doomed/")) return { ok: false, status: 503, json: async () => ({}) };
      if (calls === 1) return { ok: false, status: 429, json: async () => ({}), headers: { get: () => "0" } };
      return { ok: true, status: 200, json: async () => ({ items: [{ views: 120 }] }) };
    }) as FetchLike;
    const prev = { fetchedAt: "2025-01-01T00:00:00.000Z", entries: { Doomed: { canonical: "Doomed", missing: false, views: 7 } } };
    const r = await updateFameCache(["Fine", "Doomed"], prev, {
      fetchImpl: f,
      now: new Date("2026-11-02T00:00:00Z"),
      baseDelayMs: 1,
      retries: 2,
      concurrency: 1,
    });
    expect(r.cache.entries.Fine).toMatchObject({ views: 10, missing: false });
    expect(r.failed.map((x) => x.title)).toEqual(["Doomed"]);
    // A failed title keeps its stale entry instead of being dropped.
    expect(r.cache.entries.Doomed!.views).toBe(7);
    expect(r.pruned).toBe(0);
  });

  it("reuses fresh entries, refetches stale ones, prunes unreferenced", async () => {
    const f = fakeFetch((url) =>
      url.hostname === "en.wikipedia.org" ? wikiApi(url) : { status: 200, body: { items: [{ views: 12 }] } },
    );
    const now = new Date("2026-11-02T00:00:00Z");
    const prev = {
      fetchedAt: "2026-10-30T00:00:00.000Z",
      entries: {
        "Fresh One": { canonical: "Fresh One", missing: false, views: 5 },
        "Stale One": { canonical: "Stale One", missing: false, views: 5, fetchedAt: "2026-09-01T00:00:00.000Z" },
        Gone: { canonical: "Gone", missing: false, views: 5 },
      },
    };
    const r = await updateFameCache(["Fresh One", "Stale One"], prev, { fetchImpl: f, now });
    expect(r.reused).toBe(1);
    expect(r.fetched).toBe(1);
    expect(r.pruned).toBe(1);
    expect(r.cache.entries["Fresh One"]!.views).toBe(5);
    expect(r.cache.entries["Stale One"]!.views).toBe(1);
    expect(r.cache.entries.Gone).toBeUndefined();
    const refreshed = await updateFameCache(["Fresh One"], prev, { fetchImpl: f, now, refresh: true });
    expect(refreshed.fetched).toBe(1);
  });
});
