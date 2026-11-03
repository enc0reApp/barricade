import type { AcceptedAnswer, FinishResult } from "@/lib/api/contract";
import type { PackCatalogEntry } from "@/lib/content/types";
import { distanceFor, TIERS, type Outcome } from "@/lib/game/tiers";
import { buildReveal, type RevealInput } from "@/lib/game/reveal";
import { isPlayerId, MAX_ROUNDS, toAccepted } from "@/lib/game/rules";
import { verifyReceipt, type ReceiptPayload } from "@/lib/game/token";
import { fail, guard, json, readJsonObject } from "@/lib/server/http";
import { resolveSet } from "@/lib/server/sets";
import { beatPct, roundCrowdPct } from "@/lib/server/stats";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RECEIPT_LENGTH = 1024;

/** The accepted answer a receipt proves. Tier/points are what the player was shown at answer time. */
function answerFor(
  receipt: ReceiptPayload,
  fromPack: AcceptedAnswer | null,
  fromCatalog: PackCatalogEntry | null,
): AcceptedAnswer {
  if (fromPack) return { ...fromPack, tier: receipt.t, points: TIERS[receipt.t].points };
  // The answer left the prompt after the receipt was issued (content rebuild). Keep the outcome.
  const slug = receipt.a.slice(receipt.a.indexOf(":") + 1);
  return {
    id: receipt.a,
    name: fromCatalog?.name ?? slug.replace(/[-_]+/g, " "),
    type: fromCatalog?.type ?? "other",
    tier: receipt.t,
    points: TIERS[receipt.t].points,
    share: 0,
  };
}

/** POST /api/finish {date,playerId,receipts} — verify receipts, record stats once, reveal. */
export async function POST(req: Request): Promise<Response> {
  return guard("finish", async () => {
    const body = await readJsonObject(req);
    if (!body) return fail("bad-request");
    const { date, playerId, receipts } = body;
    if (!isPlayerId(playerId)) return fail("bad-request");
    if (!Array.isArray(receipts) || receipts.length > MAX_ROUNDS) return fail("bad-request");
    if (!receipts.every((r) => r === null || (typeof r === "string" && r.length <= MAX_RECEIPT_LENGTH))) {
      return fail("bad-request");
    }

    const now = Date.now();
    const set = await resolveSet(date, now);
    if (!set.ok) return fail(set.error);
    const { puzzle, loaded, mode } = set;
    if (receipts.length !== puzzle.prompts.length) return fail("bad-request", "wrong number of receipts");

    const outcomes: Outcome[] = [];
    const accepted: (AcceptedAnswer | null)[] = [];
    for (let i = 0; i < puzzle.prompts.length; i++) {
      const raw = receipts[i] as string | null;
      if (raw === null) {
        outcomes.push("miss");
        accepted.push(null);
        continue;
      }
      const receipt = verifyReceipt(raw);
      if (!receipt || receipt.d !== set.date || receipt.i !== i || receipt.p !== playerId) {
        return fail("bad-receipt");
      }
      const prompt = puzzle.prompts[i]!;
      const packAnswer = loaded.promptIndex(prompt).byId.get(receipt.a);
      const fromCatalog = packAnswer ? null : (loaded.catalog.byId.get(receipt.a) ?? null);
      outcomes.push(receipt.t);
      accepted.push(answerFor(receipt, packAnswer ? toAccepted(packAnswer) : null, fromCatalog));
    }
    const distance = distanceFor(outcomes);

    let crowd: FinishResult["crowd"] = { plays: null, beatPct: null };
    let yours: (RevealInput | null)[] = accepted.map((a) => (a ? { answer: a, crowdPct: null } : null));

    const store = getStore();
    // kind "none" = production without Redis: no crowd numbers rather than misleading per-instance ones.
    if (mode === "today" && store.kind !== "none") {
      await store.recordFinish(set.date, playerId, { distance, answers: accepted.map((a) => (a ? a.id : null)) });
      const stats = await store.getStats(set.date, puzzle.prompts.length);
      crowd = { plays: stats.plays, beatPct: beatPct(stats, distance) };
      yours = accepted.map((a, i) => (a ? { answer: a, crowdPct: roundCrowdPct(stats, i, a.id) } : null));
    }

    const out: FinishResult = {
      ok: true,
      number: puzzle.number,
      date: set.date,
      mode,
      outcomes,
      distance,
      rounds: buildReveal(puzzle.prompts, yours),
      crowd,
    };
    return json(out);
  });
}
