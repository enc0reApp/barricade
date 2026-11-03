import type { FlagResponse } from "@/lib/api/contract";
import { clampTyped } from "@/lib/game/match";
import { isPlayerId, isRoundIndex } from "@/lib/game/rules";
import { fail, guard, json, readJsonObject } from "@/lib/server/http";
import { resolveSet } from "@/lib/server/sets";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/flag {date,index,text,playerId} — "this should count". Logged for editors. */
export async function POST(req: Request): Promise<Response> {
  return guard("flag", async () => {
    const body = await readJsonObject(req);
    if (!body) return fail("bad-request");
    const { date, index, text, playerId } = body;
    if (!isPlayerId(playerId) || !isRoundIndex(index) || typeof text !== "string") return fail("bad-request");
    // Strip control characters before capping; editors read these raw.
    const clean = clampTyped(text.replace(/[\u0000-\u001f\u007f]+/g, " "));
    if (clean.length === 0) return fail("bad-request");

    const now = Date.now();
    const set = await resolveSet(date, now);
    if (!set.ok) return fail(set.error);
    if (!set.puzzle.prompts[index]) return fail("bad-request", "index out of range");

    await getStore().logFlag(set.date, { i: index, text: clean, p: playerId, at: now });
    const out: FlagResponse = { ok: true };
    return json(out);
  });
}
