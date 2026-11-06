/** New five-question format; existing API fixtures also cover historical seven-round sets. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as start } from "../../app/api/round/route";
import { POST as answer } from "../../app/api/answer/route";
import { POST as finish } from "../../app/api/finish/route";
import { GET as getSet } from "../../app/api/set/route";
import type { AnswerResponse, FinishResponse, RoundResponse, SetResponse } from "../../lib/api/contract";
import type { ContentPack } from "../../lib/content/types";
import { distanceFor, ROUNDS_PER_SET, START_DISTANCE, TIERS } from "../../lib/game/tiers";
import { call, FIXTURE_PACK, get, PLAYER_A, post, setup, teardown, TODAY } from "./helpers";

let dir: string;
let pack: ContentPack;
beforeEach(() => {
  pack = JSON.parse(readFileSync(FIXTURE_PACK, "utf8"));
  pack.puzzles = pack.puzzles.map((p) => ({ ...p, prompts: p.prompts.slice(0, ROUNDS_PER_SET) }));
  dir = mkdtempSync(join(tmpdir(), "barricade-five-"));
  const file = join(dir, "pack.json");
  writeFileSync(file, JSON.stringify(pack));
  setup(file);
});
afterEach(() => { teardown(); rmSync(dir, { recursive: true }); });

describe("five-question sets", () => {
  it("describes five rounds, rejects a sixth, and still requires proof before revealing answers", async () => {
    const { body } = await call<SetResponse>(getSet, get(`/api/set?date=${TODAY}`));
    expect(body).toMatchObject({ ok: true, rounds: 5, seconds: [25, 25, 25, 25, 25] });
    expect(body).not.toHaveProperty("prompts");
    expect((await call(start, post("/api/round", { date: TODAY, index: 5, playerId: PLAYER_A }))).status).toBe(400);
    expect((await call(finish, post("/api/finish", { date: TODAY, playerId: PLAYER_A, receipts: Array(5).fill(null) }))).status).toBe(400);
    expect(START_DISTANCE).toBe(500);
    expect(distanceFor(Array(5).fill("htbt"))).toBe(0);
    expect(distanceFor(Array(5).fill("miss"))).toBe(500);
  });

  it("finishes after exactly five accepted answers with the correct score and five revealed rounds", async () => {
    const receipts: string[] = [], tokens: string[] = [];
    let points = 0;
    for (let index = 0; index < ROUNDS_PER_SET; index++) {
      const prompt = pack.puzzles[1]!.prompts[index]!;
      const chosen = prompt.answers[0]!;
      const { body: round } = await call<RoundResponse>(start, post("/api/round", {
        date: TODAY, index, playerId: PLAYER_A,
        ...(index ? { prevToken: tokens[index - 1], prevReceipt: receipts[index - 1] } : {}),
      }));
      if (!round.ok) throw new Error(round.error);
      tokens.push(round.token);
      const { body: accepted } = await call<AnswerResponse>(answer, post("/api/answer", { token: round.token, text: chosen.name }));
      if (!accepted.ok || accepted.status !== "accepted") throw new Error("Answer failed");
      receipts.push(accepted.receipt);
      points += TIERS[chosen.tier].points;
    }
    const { body } = await call<FinishResponse>(finish, post("/api/finish", { date: TODAY, playerId: PLAYER_A, receipts, tokens }));
    expect(body).toMatchObject({ ok: true, distance: 500 - points });
    if (!body.ok) throw new Error(body.error);
    expect(body.rounds).toHaveLength(5);
    expect(body.outcomes).toHaveLength(5);
  });
});
