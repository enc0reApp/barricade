/**
 * Signed round tokens and answer receipts (server-only, node:crypto).
 *
 *   v2.<base64url(JSON payload)>.<base64url(HMAC-SHA256("v2." + payload))>
 *
 *   round token: { k:"r", d:date, i:index, n:number, s:startMs, p:playerId, h:packId }
 *   receipt:     { k:"c", d:date, i:index, n:number, a:answerId, t:tier, p:playerId, h:packId }
 *
 * `h` is the loaded pack's identity (LoadedPack.id: kind + epoch), `n` the
 * puzzle number. Both are checked against the serving pack, so a token or
 * receipt minted while a deployment served another pack (the public sample, a
 * preview) never scores on this one, even with the same BARRICADE_SECRET.
 *
 * Secret: BARRICADE_SECRET. Missing outside production → a fixed dev secret
 * (one warning). Missing in production → SecretMissingError.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { isDateString } from "./day";
import { isPlayerId, isRoundIndex } from "./rules";
import { TIER_IDS, type TierId } from "./tiers";

const VERSION = "v2";
const MAX_TOKEN_LENGTH = 1024;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const DEV_SECRET = "barricade-dev-secret-not-for-production";
const ANSWER_ID_RE = /^[a-z]+:[^\s]{1,150}$/;
const PACK_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export interface RoundTokenPayload {
  k: "r";
  d: string;
  i: number;
  n: number;
  s: number;
  p: string;
  /** Pack identity (LoadedPack.id). */
  h: string;
}

export interface ReceiptPayload {
  k: "c";
  d: string;
  i: number;
  /** Puzzle number. */
  n: number;
  a: string;
  t: TierId;
  p: string;
  /** Pack identity (LoadedPack.id). */
  h: string;
}

export type TokenPayload = RoundTokenPayload | ReceiptPayload;

export class SecretMissingError extends Error {
  constructor() {
    super("BARRICADE_SECRET not set");
    this.name = "SecretMissingError";
  }
}

let warnedDevSecret = false;

function secret(): string {
  const s = process.env.BARRICADE_SECRET;
  if (s && s.length > 0) return s;
  if (process.env.NODE_ENV === "production") throw new SecretMissingError();
  if (!warnedDevSecret) {
    warnedDevSecret = true;
    console.warn("[barricade] BARRICADE_SECRET is not set — using a fixed dev secret. Never do this in production.");
  }
  return DEV_SECRET;
}

function mac(body: string, key: string): Buffer {
  return createHmac("sha256", key).update(body).digest();
}

function sign(payload: TokenPayload): string {
  const key = secret();
  const body = `${VERSION}.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
  return `${body}.${mac(body, key).toString("base64url")}`;
}

function hasExactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

const isSafeInt = (x: unknown, min: number, max: number): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= min && x <= max;

const isPackId = (x: unknown): x is string => typeof x === "string" && PACK_ID_RE.test(x);

function asRound(o: Record<string, unknown>): RoundTokenPayload | null {
  if (!hasExactKeys(o, ["k", "d", "i", "n", "s", "p", "h"])) return null;
  if (o.k !== "r" || !isDateString(o.d) || !isRoundIndex(o.i) || !isPlayerId(o.p)) return null;
  if (!isSafeInt(o.n, 1, 1_000_000) || !isSafeInt(o.s, 1, Number.MAX_SAFE_INTEGER)) return null;
  if (!isPackId(o.h)) return null;
  return { k: "r", d: o.d, i: o.i, n: o.n, s: o.s, p: o.p, h: o.h };
}

function asReceipt(o: Record<string, unknown>): ReceiptPayload | null {
  if (!hasExactKeys(o, ["k", "d", "i", "n", "a", "t", "p", "h"])) return null;
  if (o.k !== "c" || !isDateString(o.d) || !isRoundIndex(o.i) || !isPlayerId(o.p)) return null;
  if (!isSafeInt(o.n, 1, 1_000_000) || !isPackId(o.h)) return null;
  if (typeof o.a !== "string" || !ANSWER_ID_RE.test(o.a)) return null;
  if (typeof o.t !== "string" || !(TIER_IDS as readonly string[]).includes(o.t)) return null;
  return { k: "c", d: o.d, i: o.i, n: o.n, a: o.a, t: o.t as TierId, p: o.p, h: o.h };
}

/** Verifies signature + shape. Returns the raw payload object or null. Throws only SecretMissingError. */
function open(token: unknown): Record<string, unknown> | null {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [version, payloadB64, sigB64] = parts as [string, string, string];
  if (version !== VERSION || !B64URL_RE.test(payloadB64) || !B64URL_RE.test(sigB64)) return null;
  const key = secret();
  const expected = mac(`${version}.${payloadB64}`, key);
  const given = Buffer.from(sigB64, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function signRound(p: Omit<RoundTokenPayload, "k">): string {
  const payload = asRound({ k: "r", d: p.d, i: p.i, n: p.n, s: p.s, p: p.p, h: p.h });
  if (!payload) throw new Error("signRound: invalid payload");
  return sign(payload);
}

export function signReceipt(p: Omit<ReceiptPayload, "k">): string {
  const payload = asReceipt({ k: "c", d: p.d, i: p.i, n: p.n, a: p.a, t: p.t, p: p.p, h: p.h });
  if (!payload) throw new Error("signReceipt: invalid payload");
  return sign(payload);
}

export function verifyRound(token: unknown): RoundTokenPayload | null {
  const o = open(token);
  return o ? asRound(o) : null;
}

export function verifyReceipt(token: unknown): ReceiptPayload | null {
  const o = open(token);
  return o ? asReceipt(o) : null;
}

/** Throws SecretMissingError when tokens can't be issued (production without BARRICADE_SECRET). */
export function assertSecret(): void {
  secret();
}
