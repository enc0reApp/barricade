/**
 * Route-handler plumbing: JSON responses, defensive body parsing, error
 * containment and post-response work. Server-only.
 *
 * Every response body is JSON matching lib/api/contract.ts. Failures carry a
 * non-2xx status AND an `{ ok:false, error }` body — clients should parse the
 * body regardless of status.
 */

import { createHash } from "node:crypto";
import { after } from "next/server";
import type { ApiError, ApiFail } from "../api/contract";
import { PackConfigError } from "../content/loader";
import { SecretMissingError } from "../game/token";

/** Largest JSON body any endpoint accepts (5 receipts ≈ 2 KB). */
export const MAX_BODY_BYTES = 16_384;

const STATUS: Record<ApiError, number> = {
  "bad-request": 400,
  "bad-date": 400,
  future: 403,
  "no-set": 404,
  "bad-token": 400,
  "bad-receipt": 400,
  server: 500,
  unavailable: 503,
};

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

export function fail(error: ApiError, message?: string): Response {
  const body: ApiFail = { ok: false, error };
  if (message) body.message = message;
  return json(body, STATUS[error]);
}

/** Parses a JSON object body. Returns null for anything else (too big, not JSON, not an object). */
export async function readJsonObject(req: Request, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  let text: string;
  try {
    text = await req.text();
  } catch {
    return null;
  }
  if (text.length === 0 || text.length > maxBytes) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Runs a handler; any thrown error becomes `{ok:false,error:'server'}` without leaking details. */
export async function guard(name: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof SecretMissingError) return fail("server", "BARRICADE_SECRET not set");
    if (err instanceof PackConfigError) {
      console.error(`[barricade] ${name}: content pack misconfigured: ${err.message}`);
      return fail("server", "content pack not configured");
    }
    console.error(`[barricade] ${name} failed:`, err);
    return fail("server");
  }
}

/**
 * Work that must not delay or break the response (stats logging). Uses
 * Next's after() inside a request; falls back to fire-and-forget elsewhere
 * (tests, scripts).
 */
export function runAfter(task: () => Promise<unknown>): void {
  const safe = () =>
    task().catch((err: unknown) => {
      console.error("[barricade] background task failed:", err);
    });
  try {
    after(safe);
  } catch {
    void safe();
  }
}

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6_RE = /^[0-9a-f:]{2,39}$/;

/** IPv6 → its /64 (a client can rotate addresses inside its own block); IPv4 as is. */
function ipKey(raw: string): string | null {
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith("[")) ip = ip.slice(1, ip.indexOf("]") > 0 ? ip.indexOf("]") : undefined);
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) ip = mapped[1]!;
  if (IPV4_RE.test(ip)) return ip;
  if (!IPV6_RE.test(ip) || !ip.includes(":")) return null;
  const [head = "", tail = ""] = ip.split("::", 2);
  const h = head ? head.split(":") : [];
  const t = ip.includes("::") ? (tail ? tail.split(":") : []) : [];
  const groups = ip.includes("::") ? [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  if (groups.length !== 8 || groups.some((g) => g.length === 0 || g.length > 4)) return null;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/**
 * A short, non-reversible id for the caller's network, for per-IP caps on
 * stats writes. The client IP comes from the platform's forwarding headers
 * (Vercel sets x-forwarded-for / x-real-ip itself): first hop, then
 * x-real-ip. null when neither holds an IP (local tools, tests) — callers
 * then skip the cap.
 */
export function clientSource(req: Request): string | null {
  const first = req.headers.get("x-forwarded-for")?.split(",")[0];
  const key = (first && ipKey(first)) || ipKey(req.headers.get("x-real-ip") ?? "");
  if (!key) return null;
  return createHash("sha256").update(`barricade-source:${key}`).digest("hex").slice(0, 16);
}
