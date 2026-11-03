import { describe, expect, it } from "vitest";
import { noSetMeta } from "../../lib/client/api";
import { REVEAL_KEY_GUARD_MS, isStaleActivation } from "../../lib/client/keys";
import {
  CROWD_MAX_WAIT_MS,
  CROWD_OPEN_PAD_MS,
  countdownEnd,
  crowdOpensAtLocal,
  crowdRetryDelay,
  localMidnightAfter,
  nextLocalMidnight,
} from "../../lib/client/timer";
import { localDateString, msUntilLocalMidnight } from "../../lib/game/day";

/** Local wall-clock instant (works in any TZ; mid-July avoids DST changes at midnight). */
const local = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0) => new Date(y, mo - 1, d, h, mi, s, ms).getTime();

describe("midnight countdown", () => {
  it("re-measuring 'next midnight' every tick never reaches zero (the old bug)", () => {
    const t0 = local(2026, 7, 15, 23, 59, 58, 400);
    let min = Infinity;
    for (let t = t0; t < t0 + 5_000; t += 1) min = Math.min(min, msUntilLocalMidnight(new Date(t)));
    expect(min).toBeGreaterThan(0);
  });

  it("a deadline fixed at start crosses zero just after local midnight", () => {
    const t0 = local(2026, 7, 15, 23, 59, 58, 400);
    const end = countdownEnd(undefined, t0);
    expect(end).toBe(local(2026, 7, 16));
    // Ticks at 23:59:58.4 and 23:59:59.4 are still counting…
    const ticks = [0, 1000].map((dt) => end - (t0 + dt));
    expect(ticks.every((r) => r > 0)).toBe(true);
    // …and the 00:00:00.4 tick fires.
    expect(end - (t0 + 2000)).toBeLessThanOrEqual(0);
    // A tab that slept through midnight fires on its first tick after waking.
    expect(end - local(2026, 7, 16, 7, 30)).toBeLessThan(0);
  });

  it("an explicit target wins", () => {
    expect(countdownEnd(1234, 999_999)).toBe(1234);
    expect(nextLocalMidnight(local(2026, 7, 15, 0, 0, 0, 0))).toBe(local(2026, 7, 16));
  });
});

describe("the next night's doors", () => {
  it("open at the local midnight that ends the set's own date", () => {
    expect(localMidnightAfter("2026-07-15")).toBe(local(2026, 7, 16));
    expect(localMidnightAfter("2026-12-31")).toBe(local(2027, 1, 1));
    expect(localMidnightAfter("2028-02-28")).toBe(local(2028, 2, 29));
  });

  it("a set finished after midnight is already past its doors-open time", () => {
    // Started 07-15 at 23:58, finished 07-16 at 00:10: the 07-16 set is open now.
    const finishedAt = local(2026, 7, 16, 0, 10);
    expect(localDateString(new Date(finishedAt))).toBe("2026-07-16");
    expect(finishedAt >= localMidnightAfter("2026-07-15")).toBe(true);
    // Whereas "next midnight from now" would wrongly say ~24h.
    expect(nextLocalMidnight(finishedAt) - finishedAt).toBe(23 * 3_600_000 + 50 * 60_000);
  });
});

describe("morning after re-checks", () => {
  it("waits for opensAt (+ pad) while it is ahead", () => {
    expect(crowdRetryDelay(10_000, 4_000, 0)).toBe(6_000 + CROWD_OPEN_PAD_MS);
    expect(crowdRetryDelay(10 ** 12, 0, 0)).toBe(CROWD_MAX_WAIT_MS); // far future: re-check hourly, never overflow setTimeout
  });

  it("backs off instead of looping when the device clock is ahead of the server", () => {
    // opensAt already passed on the device but the server still says not-yet.
    const delays = [0, 1, 2, 3, 4, 5, 6, 7, 8, 20].map((n) => crowdRetryDelay(1_000, 5_000, n));
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000, 60000]);
    expect(delays.every((d) => d >= 1000)).toBe(true);
  });

  it("converts opensAt to the device clock when the server sends its time", () => {
    // Device 1h ahead: server says 10:00, device says 11:00.
    const serverNow = 36_000_000;
    const receivedAt = serverNow + 3_600_000;
    expect(crowdOpensAtLocal({ opensAt: serverNow + 60_000, serverNow }, receivedAt)).toBe(receivedAt + 60_000);
    expect(crowdOpensAtLocal({ opensAt: 5 }, 999)).toBe(5);
    expect(crowdOpensAtLocal({ opensAt: 5, serverNow: "x" }, 999)).toBe(5);
  });
});

describe("KEEP PUSHING key guard", () => {
  it("ignores Enter/Space right after the reveal appears, and held keys", () => {
    expect(isStaleActivation({ key: "Enter", repeat: false }, 50)).toBe(true);
    expect(isStaleActivation({ key: " ", repeat: false }, REVEAL_KEY_GUARD_MS - 1)).toBe(true);
    expect(isStaleActivation({ key: "Enter", repeat: true }, 5_000)).toBe(true);
  });

  it("lets a fresh press through, and never touches other keys", () => {
    expect(isStaleActivation({ key: "Enter", repeat: false }, REVEAL_KEY_GUARD_MS + 1)).toBe(false);
    expect(isStaleActivation({ key: " ", repeat: false }, 2_000)).toBe(false);
    expect(isStaleActivation({ key: "a", repeat: false }, 0)).toBe(false);
    expect(isStaleActivation({ key: "Tab", repeat: true }, 0)).toBe(false);
  });
});

describe("no-set archive bounds", () => {
  it("reads epoch + latestNumber from a no-set reply when the server sends them", () => {
    expect(noSetMeta({ ok: false, error: "no-set", epoch: "2026-11-09", latestNumber: 15 } as never)).toEqual({ epoch: "2026-11-09", latestNumber: 15 });
    expect(noSetMeta({ ok: false, error: "no-set", epoch: "2026-11-09", latestNumber: 0 } as never)).toEqual({ epoch: "2026-11-09", latestNumber: 0 });
  });

  it("is null for a bare or malformed no-set, other errors, and successes", () => {
    expect(noSetMeta({ ok: false, error: "no-set" })).toBeNull();
    expect(noSetMeta({ ok: false, error: "no-set", epoch: "nope", latestNumber: 3 } as never)).toBeNull();
    expect(noSetMeta({ ok: false, error: "no-set", epoch: "2026-11-09", latestNumber: 1.5 } as never)).toBeNull();
    expect(noSetMeta({ ok: false, error: "server", epoch: "2026-11-09", latestNumber: 3 } as never)).toBeNull();
  });
});
