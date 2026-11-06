import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Results from "../../components/game/Results";
import YourSet from "../../components/game/YourSet";
import type { FinishResult, RevealRound } from "../../lib/api/contract";
import { nextSetOpensAt } from "../../lib/client/timer";
import { shareSiteUrl } from "../../lib/share/site-url";

const html = renderToStaticMarkup;
afterEach(() => vi.unstubAllEnvs());

describe("usable ticket links during domain cutover", () => {
  it("keeps shares on the live Vercel address before custom-domain DNS works", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://fstvl.xyz");
    expect(shareSiteUrl("https://barricade-kappa.vercel.app")).toBe("https://barricade-kappa.vercel.app");
    expect(shareSiteUrl("https://fstvl.xyz/")).toBe("https://fstvl.xyz");
  });

  it("does not accept unrelated hosts or non-web protocols from a request", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://fstvl.xyz/");
    for (const origin of [undefined, "invalid", "https://vercel.app.evil.example", "https://other.example", "javascript:alert(1)"]) {
      expect(shareSiteUrl(origin)).toBe("https://fstvl.xyz");
    }
    vi.stubEnv("NODE_ENV", "production");
    expect(shareSiteUrl("http://localhost:3107")).toBe("https://fstvl.xyz");
  });
});

describe("a ticket's next action follows the bill", () => {
  it("waits for scheduled dates, handles gaps, and has no invented final-night countdown", () => {
    expect(nextSetOpensAt("2026-11-09", "2026-11-12")).toBe(new Date(2026, 10, 12).getTime());
    expect(nextSetOpensAt("2026-11-23", null)).toBeNull();
    expect(nextSetOpensAt("2026-11-09")).toBe(new Date(2026, 10, 10).getTime());
  });

  it("offers archive play after the final set", () => {
    const finish: FinishResult = { ok: true, number: 15, date: "2026-11-23", mode: "today", outcomes: Array(7).fill("miss"), distance: 700, rounds: [], crowd: { plays: null, beatPct: null } };
    const markup = html(createElement(Results, { finish, archive: false, streak: 1, tries: {}, flagged: [], onFlag: async () => false, nextOpen: null }));
    expect(markup).toContain("PLAY THE ARCHIVE");
    expect(markup).not.toContain("DOORS OPEN IN");
    expect(markup).not.toContain("SET IS OPEN");
  });

  it("hides report actions when reports cannot be retained", () => {
    const round: RevealRound = { index: 0, text: "Name a UK festival", yours: null, picks: [], total: 40 };
    const markup = html(createElement(YourSet, { rounds: [round], tries: { 0: ["Banana Festival"] }, flagged: [], onFlag: async () => false, reportsAvailable: false }));
    expect(markup).toContain("answer reports are unavailable");
    expect(markup).not.toContain("have counted?");
    expect(markup).not.toContain("an editor will take a look");
  });
});
