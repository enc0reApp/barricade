import type { AnswerResult } from "@/lib/api/contract";
import { getLoadedPack, puzzleForDate } from "@/lib/content/loader";
import { clampTyped, matchAnswer } from "@/lib/game/match";
import { primaryKey } from "@/lib/game/normalize";
import { roundSeconds, toAccepted } from "@/lib/game/rules";
import { GRACE_MS } from "@/lib/game/tiers";
import { signReceipt, verifyRound } from "@/lib/game/token";
import { fail, guard, json, readJsonObject, runAfter } from "@/lib/server/http";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rejected tries are logged for editors only when the key is this short (no essays in Redis). */
const MAX_LOGGED_KEY = 40;

/** POST /api/answer {token,text} — match one typed answer against the round's closed list. */
export async function POST(req: Request): Promise<Response> {
  return guard("answer", async () => {
    const body = await readJsonObject(req);
    if (!body || typeof body.text !== "string") return fail("bad-request");
    const round = verifyRound(body.token);
    if (!round) return fail("bad-token");

    const loaded = await getLoadedPack();
    const puzzle = puzzleForDate(loaded, round.d);
    if (!puzzle) return fail("no-set");
    const prompt = puzzle.prompts[round.i];
    // Content changed under a live token (re-sealed pack): the round no longer exists.
    if (!prompt || puzzle.number !== round.n) return fail("bad-token");

    const now = Date.now();
    if (now > round.s + roundSeconds(prompt) * 1000 + GRACE_MS) {
      const expired: AnswerResult = { ok: true, status: "expired" };
      return json(expired);
    }

    const typed = clampTyped(body.text);
    const result = matchAnswer(prompt, typed, { prompt: loaded.promptIndex(prompt), catalog: loaded.catalog });

    if (result.kind === "accepted") {
      const { answer } = result;
      const receipt = signReceipt({ d: round.d, i: round.i, a: answer.id, t: answer.tier, p: round.p });
      const out: AnswerResult = { ok: true, status: "accepted", answer: toAccepted(answer), receipt };
      return json(out);
    }

    if (result.kind === "empty") {
      const out: AnswerResult = { ok: true, status: "rejected", reason: "empty" };
      return json(out);
    }

    const key = primaryKey(typed);
    if (key.length > 0 && key.length <= MAX_LOGGED_KEY) {
      const store = getStore();
      runAfter(() => store.logRejected(round.d, round.i, key));
    }

    if (result.kind === "offprompt") {
      const out: AnswerResult = {
        ok: true,
        status: "rejected",
        reason: "offprompt",
        canonical: { name: result.entry.name, type: result.entry.type },
      };
      return json(out);
    }
    const out: AnswerResult = { ok: true, status: "rejected", reason: "unknown" };
    return json(out);
  });
}
