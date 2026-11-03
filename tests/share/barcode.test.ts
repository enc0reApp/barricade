import { describe, expect, it } from "vitest";
import { BARCODE_MODULES, barcode } from "../../lib/share/barcode";

function modulesFromBars(length: number, bars: { x: number; w: number }[]): boolean[] {
  const m = new Array<boolean>(length).fill(false);
  for (const b of bars) for (let i = b.x; i < b.x + b.w; i++) m[i] = true;
  return m;
}

describe("barcode", () => {
  it("is deterministic", () => {
    expect(barcode("12-hbxnbbs")).toEqual(barcode("12-hbxnbbs"));
    // Pin one output so an accidental algorithm change shows up in review.
    expect(barcode("12-hbxnbbs").modules.map((b) => (b ? 1 : 0)).join("")).toMatchInlineSnapshot(`"1010111001011011010100101110100101011011010010100111001110010101"`);
  });

  it("ignores case and surrounding whitespace, like decodeShareCode", () => {
    expect(barcode("  12-HBXNBBS ")).toEqual(barcode("12-hbxnbbs"));
  });

  it("differs between codes", () => {
    const codes = ["12-hbxnbbs", "12-hbxnbbt", "13-hbxnbbs", "3-mmxtssm", "9-hhhhhhh", "1-xxxxxxx"];
    const seen = new Set(codes.map((c) => barcode(c).modules.map(Number).join("")));
    expect(seen.size).toBe(codes.length);
  });

  it("has the default length and EAN-style guards", () => {
    const { length, modules, bars } = barcode("3-mmxtssm");
    expect(length).toBe(BARCODE_MODULES);
    expect(modules).toHaveLength(BARCODE_MODULES);
    expect(modules.slice(0, 4)).toEqual([true, false, true, false]);
    expect(modules.slice(-4)).toEqual([false, true, false, true]);
    const mid = Math.floor(length / 2);
    expect(modules.slice(mid - 2, mid + 3)).toEqual([false, true, false, true, false]);
    const guards = bars.filter((b) => b.guard);
    expect(guards.map((b) => b.x)).toEqual([0, 2, mid - 1, mid + 1, length - 3, length - 1]);
    expect(guards.every((b) => b.w === 1)).toBe(true);
  });

  it("bars are sorted, in bounds, non-touching and rebuild the modules exactly", () => {
    for (const code of ["12-hbxnbbs", "3-mmxtssm", "9-hhhhhhh", "777-bbbbbbb"]) {
      const { length, modules, bars } = barcode(code);
      let prevEnd = -1;
      for (const b of bars) {
        expect(b.x).toBeGreaterThan(prevEnd); // at least one gap module between bars
        expect(b.w).toBeGreaterThanOrEqual(1);
        expect(b.w).toBeLessThanOrEqual(3);
        expect(b.x + b.w).toBeLessThanOrEqual(length);
        prevEnd = b.x + b.w;
      }
      expect(modulesFromBars(length, bars)).toEqual(modules);
    }
  });

  it("has enough ink to read as a barcode", () => {
    const { modules } = barcode("12-hbxnbbs");
    const ink = modules.filter(Boolean).length / modules.length;
    expect(ink).toBeGreaterThan(0.3);
    expect(ink).toBeLessThan(0.75);
  });

  it("supports custom lengths and rejects tiny ones", () => {
    expect(barcode("12-hbxnbbs", 96).modules).toHaveLength(96);
    expect(() => barcode("12-hbxnbbs", 10)).toThrow(RangeError);
    expect(() => barcode("12-hbxnbbs", 40.5)).toThrow(RangeError);
  });
});
