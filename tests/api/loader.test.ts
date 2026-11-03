import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLoadedPack,
  getPack,
  getPuzzle,
  latestNumber,
  resetPackCache,
} from "../../lib/content/loader";
import { seal } from "../../lib/content/seal";
import type { ContentPack } from "../../lib/content/types";
import { FIXTURE_PACK, FIXTURE_SAMPLE } from "./helpers";

const production = JSON.parse(readFileSync(FIXTURE_PACK, "utf8")) as ContentPack;
const sample = JSON.parse(readFileSync(FIXTURE_SAMPLE, "utf8")) as ContentPack;

let cwd: string;

function put(rel: string, contents: string): void {
  const file = path.join(cwd, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "barricade-loader-"));
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  vi.stubEnv("BARRICADE_PACK_PATH", "");
  vi.stubEnv("BARRICADE_SEAL_KEY", "");
  resetPackCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetPackCache();
  rmSync(cwd, { recursive: true, force: true });
});

describe("pack resolution", () => {
  it("explains what's missing when there is no pack at all", async () => {
    await expect(getPack()).rejects.toThrow(/No BARRICADE content pack found/);
  });

  it("falls back to the public sample", async () => {
    put("content/sample/pack.json", JSON.stringify(sample));
    const loaded = await getLoadedPack();
    expect(loaded.source).toBe("sample");
    expect(loaded.pack.kind).toBe("sample");
  });

  it("prefers a local build over the sample", async () => {
    put("content/sample/pack.json", JSON.stringify(sample));
    put("content/build/pack.json", JSON.stringify(production));
    expect((await getLoadedPack()).source).toBe("build");
  });

  it("prefers the sealed pack when the key is set, and ignores it otherwise", async () => {
    const key = randomBytes(32).toString("base64");
    put("content/build/pack.json", JSON.stringify(sample));
    put("content/sealed/pack.json.enc", JSON.stringify(seal(JSON.stringify(production), key, "pack")));
    expect((await getLoadedPack()).source).toBe("build");
    resetPackCache();
    vi.stubEnv("BARRICADE_SEAL_KEY", key);
    const loaded = await getLoadedPack();
    expect(loaded.source).toBe("sealed");
    expect(loaded.pack.kind).toBe("production");
    expect(loaded.pack.puzzles).toHaveLength(2);
  });

  it("refuses a sealed pack opened with the wrong key", async () => {
    put("content/sealed/pack.json.enc", JSON.stringify(seal(JSON.stringify(production), randomBytes(32).toString("base64"), "pack")));
    vi.stubEnv("BARRICADE_SEAL_KEY", randomBytes(32).toString("base64"));
    await expect(getPack()).rejects.toThrow();
  });

  it("BARRICADE_PACK_PATH wins over everything", async () => {
    put("content/build/pack.json", JSON.stringify(sample));
    vi.stubEnv("BARRICADE_PACK_PATH", FIXTURE_PACK);
    const loaded = await getLoadedPack();
    expect(loaded.source).toBe("env");
    expect(loaded.pack.kind).toBe("production");
  });

  it("refuses a pack built with another normalizeVersion", async () => {
    put("content/build/pack.json", JSON.stringify({ ...production, normalizeVersion: 999 }));
    await expect(getPack()).rejects.toThrow(/normalizeVersion 999.*NORMALIZE_VERSION 1/);
  });

  it("refuses malformed packs", async () => {
    put("content/build/pack.json", JSON.stringify({ ...production, format: 2 }));
    await expect(getPack()).rejects.toThrow(/format/);
    resetPackCache();
    put("content/build/pack.json", JSON.stringify({ ...production, epoch: "soon" }));
    await expect(getPack()).rejects.toThrow(/epoch/);
  });

  it("caches the pack, retries after a failed load, and resets on demand", async () => {
    await expect(getPack()).rejects.toThrow();
    put("content/sample/pack.json", JSON.stringify(sample));
    const a = await getPack();
    expect(await getPack()).toBe(a);
    resetPackCache();
    expect(await getPack()).not.toBe(a);
  });
});

describe("puzzles by date", () => {
  it("production: exact dates only; latestNumber capped at the schedule", async () => {
    vi.stubEnv("BARRICADE_PACK_PATH", FIXTURE_PACK);
    expect((await getPuzzle("2026-11-09"))?.number).toBe(1);
    expect((await getPuzzle("2026-11-10"))?.number).toBe(2);
    expect(await getPuzzle("2026-11-11")).toBeNull();
    expect(await getPuzzle("2026-11-08")).toBeNull();
    expect(await getPuzzle("not-a-date")).toBeNull();
    expect(await latestNumber(Date.parse("2026-11-01T00:00:00Z"))).toBe(0);
    // At 2026-11-08T10:00Z it's already 11-09 in UTC+14.
    expect(await latestNumber(Date.parse("2026-11-08T10:00:00Z"))).toBe(1);
    expect(await latestNumber(Date.parse("2026-11-09T12:00:00Z"))).toBe(2);
    expect(await latestNumber(Date.parse("2027-01-01T00:00:00Z"))).toBe(2);
  });

  it("sample: floats from its epoch onto every date, re-labelled", async () => {
    vi.stubEnv("BARRICADE_PACK_PATH", FIXTURE_SAMPLE);
    const p5 = await getPuzzle("2026-11-05");
    expect(p5).toMatchObject({ number: 5, date: "2026-11-05", title: "FIXTURE ONE" });
    expect(p5?.prompts[0]?.id).toBe("uk-festivals");
    const p100 = await getPuzzle("2027-02-08");
    expect(p100).toMatchObject({ number: 100, date: "2027-02-08" });
    expect(p100?.prompts[0]?.id).toBe("detroit-techno-artists");
    expect(await getPuzzle("2026-10-31")).toBeNull();
    expect(await latestNumber(Date.parse("2027-01-01T00:00:00Z"))).toBe(62);
    // Re-labelling never mutates the pack itself.
    expect((await getPack()).puzzles[0]).toMatchObject({ number: 1, date: "2026-11-01" });
  });

  it("builds each prompt index once and shares the catalog", async () => {
    vi.stubEnv("BARRICADE_PACK_PATH", FIXTURE_SAMPLE);
    const loaded = await getLoadedPack();
    const a = await getPuzzle("2026-11-01");
    const b = await getPuzzle("2026-11-03");
    expect(a?.prompts[0]).toBe(b?.prompts[0]);
    expect(loaded.promptIndex(a!.prompts[0]!)).toBe(loaded.promptIndex(b!.prompts[0]!));
    expect(loaded.catalog.byId.get("venue:berghain")?.name).toBe("Berghain");
  });
});
