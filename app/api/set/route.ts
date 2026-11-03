import type { SetInfo } from "@/lib/api/contract";
import { getLoadedPack, latestNumberFor } from "@/lib/content/loader";
import { roundSeconds } from "@/lib/game/rules";
import { fail, guard, json } from "@/lib/server/http";
import { resolveSet } from "@/lib/server/sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/set?date=YYYY-MM-DD — set info (never prompts or answers). */
export async function GET(req: Request): Promise<Response> {
  return guard("set", async () => {
    const date = new URL(req.url).searchParams.get("date");
    const now = Date.now();
    const set = await resolveSet(date, now);
    if (!set.ok) {
      if (set.error !== "no-set") return fail(set.error);
      // Tonight has no set (e.g. the schedule ended): still tell the archive where it starts and ends.
      const loaded = await getLoadedPack();
      return json({ ok: false, error: "no-set", epoch: loaded.pack.epoch, latestNumber: latestNumberFor(loaded, now) }, 404);
    }
    const { puzzle, loaded } = set;
    const body: SetInfo = {
      ok: true,
      number: puzzle.number,
      date: set.date,
      rounds: puzzle.prompts.length,
      seconds: puzzle.prompts.map(roundSeconds),
      mode: set.mode,
      pack: loaded.pack.kind,
      latestNumber: latestNumberFor(loaded, now),
      epoch: loaded.pack.epoch,
    };
    if (puzzle.title) body.title = puzzle.title;
    return json(body);
  });
}
