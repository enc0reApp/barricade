/**
 * What the share page needs to know about a set number. Server-only.
 *
 * The content loader is imported lazily so a broken / missing pack never takes
 * the share page or its OG image down — the ticket just omits the date.
 */

import { dateForNumber, isDateString } from "../game/day";

export interface ShareSetInfo {
  /** YYYY-MM-DD, or null when the pack can't be loaded. */
  date: string | null;
  /**
   * Whether /archive/<n> can be played right now. Unknown (pack failed) counts
   * as playable so the link degrades to the archive page's own handling.
   */
  playable: boolean;
}

interface LoaderLike {
  getPack?: () => Promise<{ epoch?: unknown }>;
  latestNumber?: (nowMs: number) => Promise<number>;
}

async function loader(): Promise<LoaderLike | null> {
  try {
    return (await import("../content/loader")) as LoaderLike;
  } catch {
    return null;
  }
}

export async function setDateFor(number: number): Promise<string | null> {
  try {
    const mod = await loader();
    if (!mod?.getPack) return null;
    const epoch = (await mod.getPack())?.epoch;
    if (!isDateString(epoch)) return null;
    const date = dateForNumber(epoch, number);
    return isDateString(date) ? date : null;
  } catch {
    return null;
  }
}

export async function shareSetInfo(number: number, nowMs: number = Date.now()): Promise<ShareSetInfo> {
  const date = await setDateFor(number);
  let playable = true;
  try {
    const mod = await loader();
    if (mod?.latestNumber) playable = number <= (await mod.latestNumber(nowMs));
  } catch {
    playable = true;
  }
  return { date, playable };
}
