import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseDotenv } from "../../lib/content/env";
import { seal, unseal } from "../../lib/content/seal";
import { applyRestore, collectBundle, isSafeBundlePath, planRestore } from "../../scripts/lib/bundle";

const key = () => randomBytes(32).toString("base64");
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "barricade-seal-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("seal / unseal", () => {
  it("round-trips text", () => {
    const k = key();
    const text = JSON.stringify({ hello: "Berghain ✓", n: [1, 2, 3] });
    const s = seal(text, k, "pack");
    expect(s.data).not.toContain("Berghain");
    expect(unseal(s, k)).toBe(text);
  });

  it("fails with the wrong key, a tampered label or ciphertext", () => {
    const k = key();
    const s = seal("secret answers", k, "pack");
    expect(() => unseal(s, key())).toThrow();
    expect(() => unseal({ ...s, label: "source" }, k)).toThrow();
    const bytes = Buffer.from(s.data, "base64");
    bytes[0] = bytes[0]! ^ 1;
    expect(() => unseal({ ...s, data: bytes.toString("base64") }, k)).toThrow();
    expect(() => seal("x", Buffer.alloc(16).toString("base64"), "pack")).toThrow(/32 bytes/);
  });
});

describe("source bundles", () => {
  it("collects every file (incl. dotfiles), seals, and restores to an empty dir", () => {
    const src = tmp();
    mkdirSync(join(src, "prompts"));
    mkdirSync(join(src, ".cache"));
    writeFileSync(join(src, "schedule.json"), '{"epoch":"2026-01-01","days":[]}\n');
    writeFileSync(join(src, "prompts", "a.json"), '{"slug":"a"}\n');
    writeFileSync(join(src, ".cache", "fame.json"), '{"entries":{}}\n');
    writeFileSync(join(src, ".DS_Store"), "junk");
    const bundle = collectBundle(src);
    expect(Object.keys(bundle).sort()).toEqual([".cache/fame.json", "prompts/a.json", "schedule.json"]);

    const k = key();
    const restored = JSON.parse(unseal(seal(JSON.stringify(bundle), k, "source"), k));
    const out = tmp();
    const plan = planRestore(restored, out);
    expect(plan.write.sort()).toEqual([".cache/fame.json", "prompts/a.json", "schedule.json"]);
    applyRestore(restored, out, plan, false);
    expect(readFileSync(join(out, "prompts", "a.json"), "utf8")).toBe('{"slug":"a"}\n');
    expect(readFileSync(join(out, ".cache", "fame.json"), "utf8")).toBe('{"entries":{}}\n');
  });

  it("refuses to overwrite differing files unless forced; skips identical ones", () => {
    const out = tmp();
    writeFileSync(join(out, "same.json"), "1");
    writeFileSync(join(out, "diff.json"), "old");
    const bundle = { "same.json": "1", "diff.json": "new", "fresh.json": "x" };
    const plan = planRestore(bundle, out);
    expect(plan).toMatchObject({ write: ["fresh.json"], same: ["same.json"], conflicts: ["diff.json"] });
    applyRestore(bundle, out, plan, false);
    expect(readFileSync(join(out, "diff.json"), "utf8")).toBe("old");
    applyRestore(bundle, out, plan, true);
    expect(readFileSync(join(out, "diff.json"), "utf8")).toBe("new");
  });

  it("rejects paths that escape the target", () => {
    expect(isSafeBundlePath("prompts/a.json")).toBe(true);
    expect(isSafeBundlePath(".cache/fame.json")).toBe(true);
    expect(isSafeBundlePath("../evil.json")).toBe(false);
    expect(isSafeBundlePath("a/../../evil")).toBe(false);
    expect(isSafeBundlePath("/etc/passwd")).toBe(false);
    expect(planRestore({ "../x": "1" }, tmp()).unsafe).toEqual(["../x"]);
  });
});

describe("parseDotenv", () => {
  it("parses keys, quotes, export and comments", () => {
    const env = parseDotenv(
      ['# comment', "BARRICADE_SEAL_KEY=abc+/=", 'export A="quoted # not comment"', "B='single'", "C=plain # trailing", "bad line"].join("\n"),
    );
    expect(env).toEqual({ BARRICADE_SEAL_KEY: "abc+/=", A: "quoted # not comment", B: "single", C: "plain" });
  });
});
