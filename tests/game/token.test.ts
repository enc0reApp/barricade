import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertSecret,
  SecretMissingError,
  signReceipt,
  signRound,
  verifyReceipt,
  verifyRound,
} from "../../lib/game/token";

const SECRET = "test-secret-0123456789";
const round = { d: "2026-11-10", i: 3, n: 2, s: 1_794_312_000_000, p: "player_ABC-123", h: "packId_0123" };
const receipt = { d: "2026-11-10", i: 3, n: 2, a: "venue:berghain", t: "htbt" as const, p: "player_ABC-123", h: "packId_0123" };

/** Signs an arbitrary payload with a valid MAC, to prove shape checks don't rely on the signature. */
function forge(payload: unknown, secret = SECRET): string {
  const body = `v2.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

beforeEach(() => {
  vi.stubEnv("BARRICADE_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("tokens", () => {
  it("round-trips a round token", () => {
    const t = signRound(round);
    expect(t).toMatch(/^v2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(verifyRound(t)).toEqual({ k: "r", ...round });
  });

  it("round-trips a receipt", () => {
    const t = signReceipt(receipt);
    expect(verifyReceipt(t)).toEqual({ k: "c", ...receipt });
  });

  it("rejects the wrong kind", () => {
    expect(verifyReceipt(signRound(round))).toBeNull();
    expect(verifyRound(signReceipt(receipt))).toBeNull();
  });

  it("rejects a tampered payload or signature", () => {
    const t = signReceipt(receipt);
    const [v, payload, sig] = t.split(".") as [string, string, string];
    const upgraded = Buffer.from(JSON.stringify({ k: "c", ...receipt, t: "htbt", a: "venue:tresor" })).toString("base64url");
    expect(verifyReceipt(`${v}.${upgraded}.${sig}`)).toBeNull();
    const flipped = `${sig.slice(0, 5)}${sig[5] === "A" ? "B" : "A"}${sig.slice(6)}`;
    expect(verifyReceipt(`${v}.${payload}.${flipped}`)).toBeNull();
    expect(verifyReceipt(`${v}.${payload}.${sig.slice(0, -4)}`)).toBeNull();
    expect(verifyReceipt(`v1.${payload}.${sig}`)).toBeNull();
    expect(verifyReceipt(`v3.${payload}.${sig}`)).toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    const t = signRound(round);
    vi.stubEnv("BARRICADE_SECRET", "another-secret");
    expect(verifyRound(t)).toBeNull();
  });

  it("rejects garbage", () => {
    for (const bad of [undefined, null, 42, {}, "", "v1", "v1.a", "v1.a.b.c", "v1.!!!.???", "x".repeat(5000)]) {
      expect(verifyRound(bad)).toBeNull();
      expect(verifyReceipt(bad)).toBeNull();
    }
  });

  it("validates payload shape strictly, even with a valid signature", () => {
    expect(verifyRound(forge({ k: "r", ...round }))).not.toBeNull();
    expect(verifyRound(forge({ k: "r", ...round, extra: 1 }))).toBeNull();
    expect(verifyRound(forge({ k: "r", ...round, d: "2026-02-30" }))).toBeNull();
    expect(verifyRound(forge({ k: "r", ...round, i: 1.5 }))).toBeNull();
    expect(verifyRound(forge({ k: "r", ...round, i: -1 }))).toBeNull();
    expect(verifyRound(forge({ k: "r", ...round, n: 0 }))).toBeNull();
    expect(verifyRound(forge({ k: "r", ...round, s: "1" }))).toBeNull();
    expect(verifyRound(forge({ k: "r", ...round, p: "short" }))).toBeNull();
    expect(verifyReceipt(forge({ k: "c", ...receipt, t: "legend" }))).toBeNull();
    expect(verifyReceipt(forge({ k: "c", ...receipt, a: "no spaces allowed" }))).toBeNull();
    expect(verifyReceipt(forge(["k", "c"]))).toBeNull();
    // Pack identity and puzzle number are part of both shapes (C2: no cross-pack replay).
    const { h: _h, ...roundNoPack } = round;
    const { n: _n, ...receiptNoNumber } = receipt;
    const { h: _rh, ...receiptNoPack } = receipt;
    expect(verifyRound(forge({ k: "r", ...roundNoPack }))).toBeNull();
    expect(verifyReceipt(forge({ k: "c", ...receiptNoNumber }))).toBeNull();
    expect(verifyReceipt(forge({ k: "c", ...receiptNoPack }))).toBeNull();
    expect(verifyRound(forge({ k: "r", ...round, h: "has spaces" }))).toBeNull();
    expect(verifyReceipt(forge({ k: "c", ...receipt, n: 0 }))).toBeNull();
    expect(verifyReceipt(forge("c"))).toBeNull();
  });

  it("refuses to sign an invalid payload", () => {
    expect(() => signRound({ ...round, p: "x" })).toThrow();
    expect(() => signReceipt({ ...receipt, t: "nope" as never })).toThrow();
  });
});

describe("secret handling", () => {
  it("uses a fixed dev secret (with a warning) outside production", () => {
    vi.stubEnv("BARRICADE_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = signRound(round);
    expect(verifyRound(t)).not.toBeNull();
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("throws SecretMissingError in production", () => {
    vi.stubEnv("BARRICADE_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => signRound(round)).toThrow(SecretMissingError);
    expect(() => assertSecret()).toThrow("BARRICADE_SECRET not set");
    expect(() => verifyRound("v2.abc.def")).toThrow(SecretMissingError);
  });
});
