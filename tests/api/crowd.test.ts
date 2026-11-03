import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as crowdGET } from "../../app/api/crowd/route";
import type { CrowdResponse } from "../../lib/api/contract";
import { at, call, get, memory, NOW, setup, teardown, TODAY, YESTERDAY } from "./helpers";

beforeEach(() => setup());
afterEach(() => teardown());

const crowd = (date: string) => call<CrowdResponse>(crowdGET, get(`/api/crowd?date=${date}`));

describe("GET /api/crowd", () => {
  it("is not open while the date is still live somewhere", async () => {
    expect(await crowd(TODAY)).toEqual({
      status: 200,
      body: { ok: false, error: "not-yet", opensAt: Date.parse("2026-11-11T12:00:00Z"), serverNow: expect.any(Number) },
    });
    expect((await crowd("2026-11-12")).body).toMatchObject({ error: "not-yet" });
  });

  it("opens the moment the date has closed everywhere", async () => {
    at(Date.parse("2026-11-11T11:59:59Z"));
    expect((await crowd(TODAY)).body).toMatchObject({ ok: false, error: "not-yet" });
    at(Date.parse("2026-11-11T12:00:00Z"));
    expect((await crowd(TODAY)).body).toMatchObject({ ok: true, number: 2, plays: 0, avgDistance: null });
  });

  it("aggregates the Morning After", async () => {
    // Puzzle #1 (2026-11-09) closed at NOW. Three finished players:
    await memory.recordFinish(YESTERDAY, "seedplayer0001", {
      distance: 630,
      answers: [
        "festival:glastonbury",
        "venue:berghain",
        "genre:house",
        "city:chicago",
        "soundsystem:funktion-one",
        "gear:roland-tr-808",
        "stage:pyramid-stage",
      ],
    });
    await memory.recordFinish(YESTERDAY, "seedplayer0002", {
      distance: 30,
      answers: [
        "festival:field-maneuvers",
        "venue:ohm",
        "genre:gqom",
        "city:mumbai",
        "soundsystem:saxon-studio",
        "gear:simmons-sds-v",
        "stage:strummerville",
      ],
    });
    await memory.recordFinish(YESTERDAY, "seedplayer0003", {
      distance: 680,
      answers: ["festival:glastonbury", null, "genre:house", null, null, null, null],
    });
    // A repeat finish never double-counts.
    await memory.recordFinish(YESTERDAY, "seedplayer0003", { distance: 0, answers: Array(7).fill("x:y") });

    const { status, body } = await crowd(YESTERDAY);
    expect(status).toBe(200);
    if (!body.ok) throw new Error(body.error);
    expect(body).toMatchObject({ number: 1, date: YESTERDAY, title: "FIXTURE ONE", plays: 3, avgDistance: 447 });
    expect(body.distribution).toHaveLength(15);
    expect(body.distribution).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0]);
    expect(body.rounds).toHaveLength(7);

    const [r0, r1, r2] = body.rounds as [CrowdRoundT, CrowdRoundT, CrowdRoundT];
    expect(r0).toEqual({
      index: 0,
      text: "Name a music festival held in the UK",
      top: [
        { name: "Glastonbury", tier: "main", pct: 66.7 },
        { name: "Field Maneuvers", tier: "htbt", pct: 33.3 },
      ],
      singles: 1,
      singleNames: ["Field Maneuvers"],
      missPct: 0,
    });
    // Ties in count: deeper tier first, and lone answers deepest-first.
    expect(r1.top.map((t) => t.name)).toEqual(["OHM", "Berghain"]);
    expect(r1.singles).toBe(2);
    expect(r1.singleNames).toEqual(["OHM", "Berghain"]);
    expect(r1.missPct).toBe(33.3);
    expect(r2.top).toEqual([
      { name: "House", tier: "main", pct: 66.7 },
      { name: "Gqom", tier: "basement", pct: 33.3 },
    ]);
  });

  it("puts 700m (all misses) alone in the last bucket; caps top lists at 8, single names at 5", async () => {
    const berlin = [
      "venue:berghain",
      "venue:tresor",
      "venue:watergate",
      "venue:panorama-bar",
      "venue:sisyphos",
      "venue:kitkatclub",
      "venue:about-blank",
      "venue:ritter-butzke",
      "venue:griessmuhle",
      "venue:ohm",
    ];
    for (let n = 0; n < berlin.length; n++) {
      await memory.recordFinish(YESTERDAY, `seedplayer${String(n).padStart(4, "0")}`, {
        distance: n === 0 ? 700 : 650,
        answers: [null, berlin[n]!, null, null, null, null, null],
      });
    }
    const { body } = await crowd(YESTERDAY);
    if (!body.ok) throw new Error(body.error);
    expect(body.distribution[13]).toBe(9); // 650–699
    expect(body.distribution[14]).toBe(1); // exactly 700
    const r1 = body.rounds[1]!;
    expect(r1.top).toHaveLength(8);
    expect(r1.singles).toBe(10);
    expect(r1.singleNames).toEqual(["OHM", "Griessmühle", "Ritter Butzke", "About Blank", "KitKatClub"]);
    expect(body.rounds[0]!.missPct).toBe(100);
  });

  it("refuses bad dates and unscheduled closed dates", async () => {
    expect(await crowd("nope")).toEqual({ status: 400, body: { ok: false, error: "bad-date" } });
    expect(await crowd("2026-11-01")).toEqual({ status: 404, body: { ok: false, error: "no-set" } });
    expect(NOW).toBe(Date.parse("2026-11-10T12:00:00Z"));
  });
});

type CrowdRoundT = Extract<CrowdResponse, { ok: true }>["rounds"][number];
