import type { CrowdResponse } from "@/lib/api/contract";
import { getLoadedPack, puzzleForDate } from "@/lib/content/loader";
import { addDays, isClosedDate, isDateString } from "@/lib/game/day";
import { fail, guard, json } from "@/lib/server/http";
import { crowdRounds, distribution } from "@/lib/server/stats";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/crowd?date=YYYY-MM-DD — the Morning After. Only for dates nobody can still be playing. */
export async function GET(req: Request): Promise<Response> {
  return guard("crowd", async () => {
    const date = new URL(req.url).searchParams.get("date");
    if (!isDateString(date)) return fail("bad-date");
    const now = Date.now();
    if (!isClosedDate(date, now)) {
      // A normal state ("opens at …"), not an error — 200 with the contract's not-yet shape.
      const notYet: CrowdResponse = {
        ok: false,
        error: "not-yet",
        opensAt: Date.parse(`${addDays(date, 1)}T12:00:00Z`),
        serverNow: Date.now(),
      };
      return json(notYet);
    }

    const loaded = await getLoadedPack();
    const puzzle = puzzleForDate(loaded, date);
    if (!puzzle) return fail("no-set");

    const store = getStore(loaded.pack.kind);
    if (store.kind === "none") return fail("unavailable");
    const stats = await store.getStats(date, puzzle.prompts.length);
    if (stats.available === false) return fail("unavailable");
    const out: Extract<CrowdResponse, { ok: true }> = {
      ok: true,
      number: puzzle.number,
      date,
      plays: stats.plays,
      avgDistance: stats.plays > 0 ? Math.round(stats.distSum / stats.plays) : null,
      distribution: distribution(stats.hist),
      rounds: crowdRounds(puzzle, stats),
    };
    if (puzzle.title) out.title = puzzle.title;
    return json(out);
  });
}
