import type { AcceptedAnswer, AnswerResult } from "@/lib/api/contract";
import { getLoadedPack, puzzleForDate } from "@/lib/content/loader";
import { isLiveDate } from "@/lib/game/day";
import { clampTyped, matchAnswer } from "@/lib/game/match";
import { primaryKey } from "@/lib/game/normalize";
import { roundSeconds, toAccepted } from "@/lib/game/rules";
import { GRACE_MS } from "@/lib/game/tiers";
import { signReceipt, verifyReceipt, verifyRound } from "@/lib/game/token";
import { fail, guard, json, readJsonObject, runAfter } from "@/lib/server/http";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rejected tries are logged for editors only when the key is this short (no essays in Redis). */
const MAX_LOGGED_KEY = 40;

type Accepted = Extract<AnswerResult, { status: "accepted" }>;

/** The stored first answer of a round, if it parses and its receipt still verifies. */
function storedAccepted(raw: string): Accepted | null {
  try {
    const v = JSON.parse(raw) as { answer?: AcceptedAnswer; receipt?: unknown };
    if (!v || typeof v !== "object" || !v.answer || typeof v.receipt !== "string" || !verifyReceipt(v.receipt)) return null;
    return { ok: true, status: "accepted", answer: v.answer, receipt: v.receipt };
  } catch {
    return null;
  }
}

/** POST /api/answer {token,text} — match one typed answer against the round's closed list. */
export async function POST(req: Request): Promise<Response> {
  return guard("answer", async () => {
    const body = await readJsonObject(req);
    if (!body || typeof body.text !== "string") return fail("bad-request");
    const round = verifyRound(body.token);
    if (!round) return fail("bad-token");

    const loaded = await getLoadedPack();
    // Minted while this deployment served another pack (sample / preview): never valid here.
    if (round.h !== loaded.id) return fail("bad-token");
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

    const live = isLiveDate(round.d, now);
    const store = getStore(loaded.pack.kind);
    const typed = clampTyped(body.text);
    // Only entities already released by this date can be named back (no future-set spoilers).
    const result = matchAnswer(prompt, typed, { prompt: loaded.promptIndex(prompt), catalog: loaded.catalogFor(round.d) });

    if (result.kind === "accepted") {
      const answer = toAccepted(result.answer);
      const receipt = signReceipt({ d: round.d, i: round.i, n: round.n, a: answer.id, t: answer.tier, p: round.p, h: round.h });
      const out: Accepted = { ok: true, status: "accepted", answer, receipt };
      if (live && store.kind !== "none") {
        // A round yields ONE receipt: a later accepted answer gets the first one back.
        const mine = JSON.stringify({ answer, receipt });
        const stood = await store.claimAccepted(round.d, round.p, round.i, mine);
        const first = stood === mine ? null : storedAccepted(stood);
        if (first) return json(first);
      }
      return json(out);
    }

    if (result.kind === "empty") {
      const out: AnswerResult = { ok: true, status: "rejected", reason: "empty" };
      return json(out);
    }

    // Logged for editors while the set is live only (archive dates would be free, unbounded targets).
    const key = primaryKey(typed);
    if (live && key.length > 0 && key.length <= MAX_LOGGED_KEY) {
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
