import type { RoundPrompt, RoundStarted } from "@/lib/api/contract";
import { isPlayerId, isRoundIndex, roundSeconds } from "@/lib/game/rules";
import { GRACE_MS } from "@/lib/game/tiers";
import { signRound, verifyReceipt, verifyRound } from "@/lib/game/token";
import { fail, guard, json, readJsonObject } from "@/lib/server/http";
import { resolveSet } from "@/lib/server/sets";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TOKEN_LENGTH = 1024;

/**
 * POST /api/round {date,index,playerId,prevToken?,prevReceipt?} — start a round:
 * one prompt + a signed clock.
 *
 * "today" mode, index > 0: proof that round index-1 is over — its round token
 * (same date, player, puzzle and pack) plus its receipt, or, with no receipt,
 * that its clock has run out (deadline + GRACE_MS). A script can't open all
 * seven rounds at once.
 *
 * With a store, the first start of a player's round is kept (SET NX): asking
 * for the same round again returns the ORIGINAL start and deadline.
 */
export async function POST(req: Request): Promise<Response> {
  return guard("round", async () => {
    const body = await readJsonObject(req);
    if (!body) return fail("bad-request");
    const { date, index, playerId, prevToken, prevReceipt } = body;
    if (!isPlayerId(playerId) || !isRoundIndex(index)) return fail("bad-request");
    if (prevToken !== undefined && (typeof prevToken !== "string" || prevToken.length > MAX_TOKEN_LENGTH)) {
      return fail("bad-request");
    }
    if (
      prevReceipt !== undefined &&
      prevReceipt !== null &&
      (typeof prevReceipt !== "string" || prevReceipt.length > MAX_TOKEN_LENGTH)
    ) {
      return fail("bad-request");
    }

    const now = Date.now();
    const set = await resolveSet(date, now);
    if (!set.ok) return fail(set.error);
    const { puzzle, loaded, mode } = set;
    const prompt = puzzle.prompts[index];
    if (!prompt) return fail("bad-request", "index out of range");

    if (mode === "today" && index > 0) {
      const prev = verifyRound(prevToken);
      if (
        !prev ||
        prev.d !== set.date ||
        prev.i !== index - 1 ||
        prev.p !== playerId ||
        prev.n !== puzzle.number ||
        prev.h !== loaded.id
      ) {
        return fail("bad-token", "previous round token required");
      }
      if (typeof prevReceipt === "string") {
        const r = verifyReceipt(prevReceipt);
        if (!r || r.d !== set.date || r.i !== index - 1 || r.p !== playerId || r.n !== puzzle.number || r.h !== loaded.id) {
          return fail("bad-receipt");
        }
      } else {
        const prevPrompt = puzzle.prompts[index - 1]!;
        if (now <= prev.s + roundSeconds(prevPrompt) * 1000 + GRACE_MS) {
          return fail("bad-request", "previous round is still running");
        }
      }
    }

    const store = getStore(loaded.pack.kind);
    // Scored play only: a repeat start never restarts the clock.
    const start =
      mode === "today" && store.kind !== "none" ? await store.claimRoundStart(set.date, playerId, index, now) : now;

    const seconds = roundSeconds(prompt);
    const token = signRound({ d: set.date, i: index, n: puzzle.number, s: start, p: playerId, h: loaded.id });
    const shown: RoundPrompt = {
      index,
      total: puzzle.prompts.length,
      text: prompt.text,
      types: [...prompt.types],
      seconds,
    };
    if (prompt.hint) shown.hint = prompt.hint;
    const out: RoundStarted = { ok: true, prompt: shown, token, deadline: start + seconds * 1000, serverNow: now };
    return json(out);
  });
}
