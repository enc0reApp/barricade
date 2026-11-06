import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as setGET } from "../../app/api/set/route";
import { GET as crowdGET } from "../../app/api/crowd/route";
import { POST as flagPOST } from "../../app/api/flag/route";
import { POST as finishPOST } from "../../app/api/finish/route";
import { POST as roundPOST } from "../../app/api/round/route";
import { getLoadedPack, indexPack, nextDateFor } from "../../lib/content/loader";
import type { RoundResponse } from "../../lib/api/contract";
import { MemoryStore } from "../../lib/store";
import { at, call, FIXTURE_SAMPLE, get, memory, NOW, PLAYER_A, post, setup, teardown, TODAY, YESTERDAY } from "./helpers";

beforeEach(() => setup());
afterEach(() => teardown());

const report = () => call(flagPOST, post("/api/flag", { date: TODAY, index: 0, text: "Mike Banks", playerId: PLAYER_A }));

describe("scheduled return journey", () => {
  it("offers the next real set and stops promising new doors after the final set", async () => {
    expect((await call(setGET, get(`/api/set?date=${YESTERDAY}`))).body.nextDate).toBe(TODAY);
    expect((await call(setGET, get(`/api/set?date=${TODAY}`))).body.nextDate).toBeNull();
    const loaded = await getLoadedPack();
    const pack = structuredClone(loaded.pack);
    pack.puzzles[1]!.date = "2026-11-14";
    const withGap = indexPack(pack, "env", "fixture");
    expect(nextDateFor(withGap, YESTERDAY)).toBe("2026-11-14");
  });

  it("keeps the floating public sample available on successive nights", async () => {
    setup(FIXTURE_SAMPLE);
    expect((await call(setGET, get(`/api/set?date=${TODAY}`))).body.nextDate).toBe("2026-11-11");
  });
});

describe("honest optional services", () => {
  it("keeps tickets working without Redis and never confirms a discarded report", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BARRICADE_MEMORY_STORE", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await report()).toMatchObject({ status: 503, body: { ok: false, error: "unavailable" } });
    expect(await call(crowdGET, get(`/api/crowd?date=${YESTERDAY}`))).toEqual({
      status: 503, body: { ok: false, error: "unavailable" },
    });
    expect(await call(finishPOST, post("/api/finish", { date: YESTERDAY, playerId: PLAYER_A, receipts: Array(7).fill(null) }))).toMatchObject({
      status: 200, body: { ok: true, distance: 700, reportsAvailable: false, crowd: { plays: null, beatPct: null } },
    });
  });

  it("a failed report stays retryable, and only a successful write gets a confirmation", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const write = vi.spyOn(MemoryStore.prototype, "logFlag").mockRejectedValueOnce(new Error("offline"));
    expect(await report()).toMatchObject({ status: 500, body: { ok: false, error: "server" } });
    expect(memory.flags(TODAY)).toHaveLength(0);
    write.mockRestore();
    expect(await report()).toEqual({ status: 200, body: { ok: true } });
    expect(memory.flags(TODAY)).toHaveLength(1);
  });

  it("a stats outage is unavailable, rather than an empty crowd", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(MemoryStore.prototype, "getStats").mockRejectedValue(new Error("offline"));
    expect(await call(crowdGET, get(`/api/crowd?date=${YESTERDAY}`))).toEqual({
      status: 503, body: { ok: false, error: "unavailable" },
    });
  });
});

describe("round timing under server latency", () => {
  it("reports the response clock after a slow round-start write", async () => {
    vi.spyOn(MemoryStore.prototype, "claimRoundStart").mockImplementationOnce(async (_d, _p, _i, start) => {
      at(NOW + 5000);
      return start;
    });
    const { body } = await call<RoundResponse>(roundPOST, post("/api/round", { date: TODAY, index: 0, playerId: PLAYER_A }));
    if (!body.ok) throw new Error(body.error);
    expect(body.deadline - body.serverNow).toBe(20_000);
  });
});
