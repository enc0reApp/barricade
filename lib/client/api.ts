/**
 * Typed fetchers for every endpoint in lib/api/contract.ts.
 *
 * Relative URLs, JSON in/out. Any network failure, timeout or unparseable
 * body becomes { ok: false, error: "server" } so callers only ever branch on
 * the contract's shapes.
 *
 * In development the fake API in ./mock.ts can stand in (NEXT_PUBLIC_BARRICADE_MOCK=1
 * or ?mock=1). It is never used in production builds.
 */

import type {
  AnswerRequest,
  AnswerResponse,
  ApiFail,
  CrowdResponse,
  FinishRequest,
  FinishResponse,
  FlagRequest,
  FlagResponse,
  RoundRequest,
  RoundResponse,
  SetResponse,
} from "../api/contract";
import { isDateString } from "../game/day";
import type { MockFlavour } from "./mock";

export interface BarricadeApi {
  getSet(date: string): Promise<SetResponse>;
  startRound(req: RoundRequest): Promise<RoundResponse>;
  answer(req: AnswerRequest): Promise<AnswerResponse>;
  finish(req: FinishRequest): Promise<FinishResponse>;
  flag(req: FlagRequest): Promise<FlagResponse>;
  crowd(date: string): Promise<CrowdResponse>;
}

const TIMEOUT_MS = 12_000;
const SERVER_FAIL: ApiFail = { ok: false, error: "server" };
const MOCK_SESSION_KEY = "barricade:mock";
const MOCK_FLAVOURS: readonly MockFlavour[] = ["on", "closed", "error", "slow"];

/* ───────────────────────────── mock switch ───────────────────────────── */

/**
 * Which mock flavour is active, or null for the real API. Only ever non-null
 * outside production. A ?mock= query is remembered for the tab so links keep it.
 */
export function mockFlavour(): MockFlavour | null {
  if (process.env.NODE_ENV === "production") return null;
  if (typeof window === "undefined") return process.env.NEXT_PUBLIC_BARRICADE_MOCK === "1" ? "on" : null;
  let fromUrl: string | null = null;
  try {
    fromUrl = new URLSearchParams(window.location.search).get("mock");
  } catch {
    fromUrl = null;
  }
  try {
    if (fromUrl === "0") window.sessionStorage.removeItem(MOCK_SESSION_KEY);
    else if (fromUrl !== null) window.sessionStorage.setItem(MOCK_SESSION_KEY, fromUrl === "1" ? "on" : fromUrl);
  } catch {
    /* storage blocked — the URL still wins for this page */
  }
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(MOCK_SESSION_KEY);
  } catch {
    stored = fromUrl === null || fromUrl === "0" ? null : fromUrl === "1" ? "on" : fromUrl;
  }
  if (fromUrl === "0") return null;
  const pick = stored ?? (process.env.NEXT_PUBLIC_BARRICADE_MOCK === "1" ? "on" : null);
  if (pick === null) return null;
  return (MOCK_FLAVOURS as readonly string[]).includes(pick) ? (pick as MockFlavour) : "on";
}

export function isMockActive(): boolean {
  return mockFlavour() !== null;
}

let mockCache: { flavour: MockFlavour; api: BarricadeApi } | null = null;

async function mockApi(): Promise<BarricadeApi | null> {
  if (process.env.NODE_ENV === "production") return null;
  const flavour = mockFlavour();
  if (!flavour) return null;
  if (mockCache && mockCache.flavour === flavour) return mockCache.api;
  const mod = await import("./mock");
  mockCache = { flavour, api: mod.createMockApi(flavour) };
  return mockCache.api;
}

/* ───────────────────────────── transport ───────────────────────────── */

function isResponseShape(x: unknown): x is { ok: boolean } {
  return typeof x === "object" && x !== null && typeof (x as { ok?: unknown }).ok === "boolean";
}

async function request<T>(url: string, init?: RequestInit): Promise<T | ApiFail> {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return SERVER_FAIL;
    }
    // Error statuses still carry a contract-shaped ApiFail body; trust the shape, not the status.
    return isResponseShape(body) ? (body as T | ApiFail) : SERVER_FAIL;
  } catch {
    return SERVER_FAIL;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function post<T>(url: string, body: unknown): Promise<T | ApiFail> {
  return request<T>(url, { method: "POST", body: JSON.stringify(body) });
}

/* ───────────────────────────── endpoints ───────────────────────────── */

export async function getSet(date: string): Promise<SetResponse> {
  const m = await mockApi();
  if (m) return m.getSet(date);
  return request<SetResponse>(`/api/set?date=${encodeURIComponent(date)}`) as Promise<SetResponse>;
}

export async function startRound(req: RoundRequest): Promise<RoundResponse> {
  const m = await mockApi();
  if (m) return m.startRound(req);
  return post<RoundResponse>("/api/round", req) as Promise<RoundResponse>;
}

export async function sendAnswer(req: AnswerRequest): Promise<AnswerResponse> {
  const m = await mockApi();
  if (m) return m.answer(req);
  return post<AnswerResponse>("/api/answer", req) as Promise<AnswerResponse>;
}

export async function finishSet(req: FinishRequest): Promise<FinishResponse> {
  const m = await mockApi();
  if (m) return m.finish(req);
  return post<FinishResponse>("/api/finish", req) as Promise<FinishResponse>;
}

export async function sendFlag(req: FlagRequest): Promise<FlagResponse> {
  const m = await mockApi();
  if (m) return m.flag(req);
  return post<FlagResponse>("/api/flag", req) as Promise<FlagResponse>;
}

export async function getCrowd(date: string): Promise<CrowdResponse> {
  const m = await mockApi();
  if (m) return m.crowd(date);
  return request<CrowdResponse>(`/api/crowd?date=${encodeURIComponent(date)}`) as Promise<CrowdResponse>;
}

/* ───────────────────────────── response helpers ───────────────────────────── */

/** Archive bounds a /api/set no-set reply can carry (tonight has no set, but earlier ones exist). */
export interface NoSetMeta {
  epoch: string;
  latestNumber: number;
}

/**
 * The archive bounds from a no-set reply, when the server sent them (it knows
 * the schedule even after it has run out). Null otherwise — callers then fall
 * back to what this device has played.
 */
export function noSetMeta(res: SetResponse): NoSetMeta | null {
  if (res.ok || res.error !== "no-set") return null;
  const r = res as { epoch?: unknown; latestNumber?: unknown };
  if (!isDateString(r.epoch)) return null;
  if (typeof r.latestNumber !== "number" || !Number.isInteger(r.latestNumber) || r.latestNumber < 0) return null;
  return { epoch: r.epoch, latestNumber: r.latestNumber };
}

/** The whole API as one object (handy for injecting a fake in tests). */
export const api: BarricadeApi = {
  getSet,
  startRound,
  answer: sendAnswer,
  finish: finishSet,
  flag: sendFlag,
  crowd: getCrowd,
};
