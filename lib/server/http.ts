/**
 * Route-handler plumbing: JSON responses, defensive body parsing, error
 * containment and post-response work. Server-only.
 *
 * Every response body is JSON matching lib/api/contract.ts. Failures carry a
 * non-2xx status AND an `{ ok:false, error }` body — clients should parse the
 * body regardless of status.
 */

import { after } from "next/server";
import type { ApiError, ApiFail } from "../api/contract";
import { SecretMissingError } from "../game/token";

/** Largest JSON body any endpoint accepts (7 receipts ≈ 2 KB). */
export const MAX_BODY_BYTES = 16_384;

const STATUS: Record<ApiError, number> = {
  "bad-request": 400,
  "bad-date": 400,
  future: 403,
  "no-set": 404,
  "bad-token": 400,
  "bad-receipt": 400,
  server: 500,
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
