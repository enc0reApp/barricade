/**
 * Shared setup for route-handler tests: the fixture pack, a fixed secret, the
 * memory store and a fake clock (Date only — real timers keep async I/O working).
 */

import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { resetPackCache } from "../../lib/content/loader";
import { MemoryStore, resetStoreCache } from "../../lib/store";

export const FIXTURE_PACK = fileURLToPath(new URL("../fixtures/pack.json", import.meta.url));
export const FIXTURE_SAMPLE = fileURLToPath(new URL("../fixtures/sample-pack.json", import.meta.url));

/** Puzzle #2 (2026-11-10) is "today"; #1 (2026-11-09) is archive and closed; 11-11 has no set; 11-12 is future. */
export const NOW = Date.parse("2026-11-10T12:00:00Z");
export const TODAY = "2026-11-10";
export const YESTERDAY = "2026-11-09";

export const memory = new MemoryStore();

export function setup(packPath = FIXTURE_PACK, now = NOW): void {
  vi.stubEnv("BARRICADE_PACK_PATH", packPath);
  vi.stubEnv("BARRICADE_SECRET", "api-test-secret");
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("KV_REST_API_TOKEN", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  resetPackCache();
  resetStoreCache();
  memory.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
}

export function teardown(): void {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetPackCache();
  resetStoreCache();
}

export function at(ms: number): void {
  vi.setSystemTime(ms);
}

export function get(path: string): Request {
  return new Request(`http://barricade.test${path}`);
}

export function post(path: string, body: unknown): Request {
  return new Request(`http://barricade.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export async function call<T = Record<string, unknown>>(
  handler: (req: Request) => Promise<Response>,
  req: Request,
): Promise<{ status: number; body: T }> {
  const res = await handler(req);
  return { status: res.status, body: (await res.json()) as T };
}

/** Let fire-and-forget work (rejected-try logging) settle. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export const PLAYER_A = "playerAAAA0001";
export const PLAYER_B = "playerBBBB0002";
export const PLAYER_C = "playerCCCC0003";
