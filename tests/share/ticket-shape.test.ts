import { describe, expect, it } from "vitest";
import { notchProfile, ticketClipPathCss, ticketClipPathPx, ticketShape } from "../../lib/share/ticket-shape";

function resolve(points: ReturnType<typeof ticketShape>, w: number, h: number): [number, number][] {
  return points.map(([x, y]) => [x.f * w + x.o, y.f * h + y.o]);
}

/** Shoelace area; positive = clockwise in screen coordinates (y down). */
function signedArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

describe("ticket shape", () => {
  it("notch profile narrows towards the bottom of the bite", () => {
    const p = notchProfile(5);
    expect(p).toHaveLength(5);
    for (let i = 1; i < p.length; i++) expect(p[i]!).toBeLessThanOrEqual(p[i - 1]!);
    expect(p[p.length - 1]!).toBeGreaterThanOrEqual(1);
  });

  for (const orientation of ["landscape", "portrait"] as const) {
    it(`${orientation}: rectilinear, clockwise, inside the box, area = box − corners − notches`, () => {
      const opts = { orientation, stub: 300, step: 6, notch: 5, corner: 2 };
      const W = 1092;
      const H = 522;
      const pts = resolve(ticketShape(opts), W, H);
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i]!;
        const [x2, y2] = pts[(i + 1) % pts.length]!;
        expect(x1 === x2 || y1 === y2).toBe(true); // pixel art: only axis-aligned edges
        expect(x1).toBeGreaterThanOrEqual(0);
        expect(x1).toBeLessThanOrEqual(W);
        expect(y1).toBeGreaterThanOrEqual(0);
        expect(y1).toBeLessThanOrEqual(H);
      }
      const notchArea = notchProfile(5).reduce((s, hw) => s + 2 * hw * 6 * 6, 0);
      const cornerArea = 4 * (2 + 1) * 6 * 6; // 2-step staircase cuts 3 pixel squares per corner
      expect(signedArea(pts)).toBe(W * H - 2 * notchArea - cornerArea);
    });
  }

  it("formats CSS and px polygons", () => {
    const opts = { orientation: "landscape" as const, stub: 232, step: 4, notch: 4, corner: 2 };
    const css = ticketClipPathCss(opts);
    expect(css.startsWith("polygon(")).toBe(true);
    // The notch is centred on the perforation (232px from the right): its
    // mouth on the top edge spans ± the first profile row.
    const half = notchProfile(4)[0]! * 4;
    expect(css).toContain(`calc(100% - ${232 + half}px) 0px`);
    expect(css).toContain(`calc(100% - ${232 - half}px) 0px`);
    expect(css).not.toContain("NaN");
    const px = ticketClipPathPx(opts, 800, 400);
    expect(px).not.toContain("calc");
    expect(px).toContain(`${800 - 232 - half}px 0px`);
    expect(px).toContain(`${800 - 232 + half}px 0px`);
    // Shifting re-anchors every point (used to clip a child with the parent's outline).
    expect(ticketClipPathPx(opts, 800, 400, -568, 0)).toContain(`${-half}px 0px`);
  });
});
