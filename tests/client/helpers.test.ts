import { describe, expect, it } from "vitest";
import { barcode } from "../../lib/share/barcode";
import { encodeShareCode } from "../../lib/share/code";
import { flavourFor, FLAVOUR } from "../../lib/client/flavour";
import { formatCountdown, formatPercentNumber, formatSetDate, formatSetDateLong, formatShare, plaqueText } from "../../lib/client/format";
import { buildRevealCurve, countAt, revealDuration, spreadLabels, targetFor, tierLines } from "../../lib/client/reveal";
import { clockOffset, displaySeconds, isExpired, litSegments, remainingMs, vuLevel } from "../../lib/client/timer";

describe("timer maths", () => {
  it("corrects for server clock skew", () => {
    const clientStart = 1_000_000;
    const serverNow = clientStart + 1_500; // server 1.5s ahead
    const deadline = serverNow + 25_000;
    const offset = clockOffset(serverNow, clientStart);
    expect(offset).toBe(1_500);
    expect(remainingMs(deadline, offset, clientStart)).toBe(25_000);
    expect(remainingMs(deadline, offset, clientStart + 10_000)).toBe(15_000);
    expect(remainingMs(deadline, offset, clientStart + 30_000)).toBe(0);
    expect(isExpired(deadline, offset, clientStart + 25_000)).toBe(true);
    expect(isExpired(deadline, offset, clientStart + 24_999)).toBe(false);
  });

  it("rounds the visible seconds up and drains one segment per second", () => {
    expect(displaySeconds(25_000)).toBe(25);
    expect(displaySeconds(24_001)).toBe(25);
    expect(displaySeconds(200)).toBe(1);
    expect(displaySeconds(0)).toBe(0);
    expect(litSegments(25, 25_000)).toBe(25);
    expect(litSegments(25, 9_100)).toBe(10);
    expect(litSegments(25, 99_000)).toBe(25);
  });

  it("goes green → amber at 10s → red at 5s", () => {
    expect(vuLevel(25)).toBe("ok");
    expect(vuLevel(11)).toBe("ok");
    expect(vuLevel(10)).toBe("warn");
    expect(vuLevel(6)).toBe("warn");
    expect(vuLevel(5)).toBe("danger");
    expect(vuLevel(0)).toBe("danger");
  });
});

describe("reveal easing", () => {
  it("spaces tier lines by points", () => {
    expect(tierLines().map((l) => l.points)).toEqual([10, 15, 30, 60, 85, 100]);
    expect(targetFor("basement")).toBe(85);
    expect(targetFor("miss")).toBe(0);
  });

  it("runs 1.6s to 2.6s by tier", () => {
    expect(revealDuration(10)).toBe(1600);
    expect(revealDuration(100)).toBe(2600);
    expect(revealDuration(60)).toBeGreaterThan(1600);
  });

  it("starts at 0, ends exactly on the target, never goes backwards or overshoots", () => {
    for (const target of [10, 15, 30, 60, 85, 100]) {
      const c = buildRevealCurve(target);
      expect(c.at(0)).toBe(0);
      expect(c.at(1)).toBe(target);
      let prev = 0;
      for (let k = 1; k <= 200; k++) {
        const x = c.at(k / 200);
        expect(x).toBeGreaterThanOrEqual(prev - 1e-9);
        expect(x).toBeLessThanOrEqual(target + 1e-9);
        prev = x;
      }
    }
  });

  it("hesitates at tier lines on the way", () => {
    const c = buildRevealCurve(100);
    // Fraction of time spent within ±1.5 of the 60 line vs an empty stretch of the same width (42..45).
    const timeIn = (lo: number, hi: number) => {
      let n = 0;
      for (let k = 0; k <= 2000; k++) {
        const x = c.at(k / 2000);
        if (x >= lo && x <= hi) n++;
      }
      return n;
    };
    expect(timeIn(58.5, 61.5)).toBeGreaterThan(timeIn(42, 45) * 1.8);
  });

  it("decelerates into the final line", () => {
    const c = buildRevealCurve(85);
    const early = c.at(0.5) - c.at(0.45);
    const late = c.at(1) - c.at(0.95);
    expect(late).toBeLessThan(early);
  });

  it("handles a zero target", () => {
    const c = buildRevealCurve(0);
    expect(c.at(0.5)).toBe(0);
  });

  it("spreads overlapping labels apart and keeps them under the top", () => {
    const out = spreadLabels([50, 75, 150, 300, 425, 500], 18);
    expect(out).toEqual([50, 75, 150, 300, 425, 500]);
    const tight = spreadLabels([20, 30, 60, 120, 170, 200], 18);
    for (let i = 1; i < tight.length; i++) expect(tight[i]! - tight[i - 1]!).toBeGreaterThanOrEqual(18 - 1e-9);
    expect(Math.max(...tight)).toBeLessThanOrEqual(200);
  });

  it("counts with an ease-out", () => {
    expect(countAt(700, 615, 0, 600)).toBe(700);
    expect(countAt(700, 615, 600, 600)).toBe(615);
    expect(countAt(700, 615, 300, 600)).toBeLessThan(658); // past halfway by half time
    expect(countAt(700, 615, 0, 0)).toBe(615);
  });
});

describe("barcode (shared generator) as the ticket uses it", () => {
  it("is deterministic per share code and differs between codes", () => {
    const code = encodeShareCode(12, ["htbt", "basement", "miss", "tent", "basement", "basement", "side"]);
    const a = barcode(code);
    const b = barcode(code);
    expect(a).toEqual(b);
    expect(barcode("12-mmmmmmm").modules).not.toEqual(barcode("12-hhhhhhh").modules);
    expect(a.modules.length).toBe(a.length);
    for (const bar of a.bars) expect(bar.x + bar.w).toBeLessThanOrEqual(a.length);
  });
});

describe("formatting", () => {
  it("formats set dates without timezone drift", () => {
    expect(formatSetDate("2026-11-09")).toBe("MON 09 NOV");
    expect(formatSetDateLong("2026-11-09")).toBe("MON 09 NOV 2026");
  });

  it("formats countdowns and percentages", () => {
    expect(formatCountdown(6 * 3600_000 + 12 * 60_000 + 33_000)).toBe("06:12:33");
    expect(formatCountdown(-5)).toBe("00:00:00");
    expect(formatShare(0.003)).toBe("≈0.3%");
    expect(formatShare(0.12)).toBe("≈12%");
    expect(formatShare(0.0004)).toBe("<0.1%");
    expect(formatPercentNumber(64.4)).toBe("64");
  });

  it("uppercases and trims plaque text", () => {
    expect(plaqueText("Berghain")).toBe("BERGHAIN");
    expect(plaqueText("Salon zur wilden Renate und so weiter", 20)).toHaveLength(20);
  });

  it("picks a stable flavour line per seed", () => {
    expect(flavourFor("tent", "2026-11-09:3")).toBe(flavourFor("tent", "2026-11-09:3"));
    expect(FLAVOUR.tent).toContain(flavourFor("tent", "x"));
  });
});
