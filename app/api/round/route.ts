import type { RoundPrompt, RoundStarted } from "@/lib/api/contract";
import { isPlayerId, isRoundIndex, roundSeconds } from "@/lib/game/rules";
import { signRound } from "@/lib/game/token";
import { fail, guard, json, readJsonObject } from "@/lib/server/http";
import { resolveSet } from "@/lib/server/sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/round {date,index,playerId} — start a round: one prompt + a signed clock. */
export async function POST(req: Request): Promise<Response> {
  return guard("round", async () => {
    const body = await readJsonObject(req);
    if (!body) return fail("bad-request");
    const { date, index, playerId } = body;
    if (!isPlayerId(playerId) || !isRoundIndex(index)) return fail("bad-request");

    const now = Date.now();
    const set = await resolveSet(date, now);
    if (!set.ok) return fail(set.error);
    const { puzzle } = set;
    const prompt = puzzle.prompts[index];
    if (!prompt) return fail("bad-request", "index out of range");

    const seconds = roundSeconds(prompt);
    const token = signRound({ d: set.date, i: index, n: puzzle.number, s: now, p: playerId });
    const shown: RoundPrompt = {
      index,
      total: puzzle.prompts.length,
      text: prompt.text,
      types: [...prompt.types],
      seconds,
    };
    if (prompt.hint) shown.hint = prompt.hint;
    const out: RoundStarted = { ok: true, prompt: shown, token, deadline: now + seconds * 1000, serverNow: now };
    return json(out);
  });
}
