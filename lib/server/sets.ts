/**
 * Date → set resolution shared by every endpoint. Server-only.
 */

import { getLoadedPack, puzzleForDate, type LoadedPack } from "../content/loader";
import type { PackPuzzle } from "../content/types";
import { isDateString, isLiveDate, liveDateWindow } from "../game/day";

export type SetCheck =
  | { ok: true; date: string; puzzle: PackPuzzle; mode: "today" | "archive"; loaded: LoadedPack }
  | { ok: false; error: "bad-date" | "future" | "no-set" };

/**
 * bad-date  — not a real YYYY-MM-DD
 * future    — not live anywhere on Earth yet (no spoilers)
 * no-set    — nothing scheduled for that date
 * mode      — "today" while the date is live somewhere, else "archive"
 */
export async function resolveSet(date: unknown, nowMs: number): Promise<SetCheck> {
  if (!isDateString(date)) return { ok: false, error: "bad-date" };
  if (date > liveDateWindow(nowMs).latest) return { ok: false, error: "future" };
  const loaded = await getLoadedPack();
  const puzzle = puzzleForDate(loaded, date);
  if (!puzzle) return { ok: false, error: "no-set" };
  return { ok: true, date, puzzle, mode: isLiveDate(date, nowMs) ? "today" : "archive", loaded };
}
