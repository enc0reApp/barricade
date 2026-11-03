/**
 * The ticket's silhouette as a clip-path polygon: stepped (pixel) corners and
 * two stepped half-circle notches where the perforation meets the edges.
 * Pure — used by the OG renderer (absolute px) and the HTML ticket (CSS calc()).
 *
 *   landscape: perforation is vertical, `stub` px from the RIGHT edge,
 *              notches bite into the top and bottom edges.
 *   portrait:  perforation is horizontal, `stub` px from the BOTTOM edge,
 *              notches bite into the left and right edges.
 */

/** A coordinate as `fraction × size + offset px` — fraction is 0 or 1. */
export interface Coord {
  f: 0 | 1;
  o: number;
}
export type ShapePoint = [x: Coord, y: Coord];

export interface TicketShapeOptions {
  orientation: "landscape" | "portrait";
  /** Distance of the perforation from the right (landscape) or bottom (portrait) edge, px. */
  stub: number;
  /** Size of one pixel step, px. */
  step: number;
  /** Notch radius in steps. */
  notch: number;
  /** Corner staircase depth in steps (0 = square corners). */
  corner: number;
}

const c = (f: 0 | 1, o: number): Coord => ({ f, o });

/** Half-widths (in steps) of a stepped half circle, one per row from the edge inwards. */
export function notchProfile(radius: number): number[] {
  const rows: number[] = [];
  for (let k = 0; k < radius; k++) {
    rows.push(Math.max(1, Math.round(Math.sqrt(radius * radius - (k + 0.5) * (k + 0.5)))));
  }
  return rows;
}

/**
 * Notch outline in edge-local coords: u runs along the edge (px from the notch
 * centre), v is depth into the ticket (px). Returned in walking order (−u → +u).
 */
function notchLocal(step: number, radius: number): [number, number][] {
  const prof = notchProfile(radius);
  const pts: [number, number][] = [];
  // Left flank, going down into the ticket.
  for (let k = 0; k < prof.length; k++) {
    const hw = prof[k]! * step;
    pts.push([-hw, k * step], [-hw, (k + 1) * step]);
  }
  // Right flank, coming back up.
  for (let k = prof.length - 1; k >= 0; k--) {
    const hw = prof[k]! * step;
    pts.push([hw, (k + 1) * step], [hw, k * step]);
  }
  return dedupe(pts);
}

/** Corner staircase going from the left edge to the top edge (local: x right, y down). */
function cornerLocal(step: number, depth: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let k = depth; k >= 1; k--) {
    pts.push([depth - k, k], [depth - k + 1, k]);
  }
  pts.push([depth, 0]);
  return dedupe(pts.map(([x, y]) => [x * step, y * step]));
}

function dedupe(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  // Drop collinear middles.
  const res: [number, number][] = [];
  for (let i = 0; i < out.length; i++) {
    const a = res[res.length - 1];
    const b = out[i]!;
    const n = out[i + 1];
    if (a && n && ((a[0] === b[0] && b[0] === n[0]) || (a[1] === b[1] && b[1] === n[1]))) continue;
    res.push(b);
  }
  return res;
}

/** Clockwise outline, starting at the top-left corner. */
export function ticketShape(opts: TicketShapeOptions): ShapePoint[] {
  const { orientation, stub, step, notch, corner } = opts;
  const notchPts = notchLocal(step, notch);
  const cornerPts = corner > 0 ? cornerLocal(step, corner) : [[0, 0] as [number, number]];
  const pts: ShapePoint[] = [];

  // Each corner, rotated into place. Local (x right, y down) at the top-left.
  const corners: Record<"tl" | "tr" | "br" | "bl", (lx: number, ly: number) => ShapePoint> = {
    tl: (lx, ly) => [c(0, lx), c(0, ly)],
    tr: (lx, ly) => [c(1, -ly), c(0, lx)],
    br: (lx, ly) => [c(1, -lx), c(1, -ly)],
    bl: (lx, ly) => [c(0, ly), c(1, -lx)],
  };
  const pushCorner = (k: keyof typeof corners) => {
    for (const [lx, ly] of cornerPts) pts.push(corners[k](lx, ly));
  };

  pushCorner("tl");
  if (orientation === "landscape") {
    // Top edge, notch centred at (W - stub, 0), biting down.
    for (const [u, v] of notchPts) pts.push([c(1, -stub + u), c(0, v)]);
    pushCorner("tr");
    pushCorner("br");
    // Bottom edge walks right → left, notch biting up.
    for (const [u, v] of notchPts) pts.push([c(1, -stub - u), c(1, -v)]);
    pushCorner("bl");
  } else {
    pushCorner("tr");
    // Right edge walks top → bottom, notch centred at (W, H - stub), biting left.
    for (const [u, v] of notchPts) pts.push([c(1, -v), c(1, -stub + u)]);
    pushCorner("br");
    pushCorner("bl");
    // Left edge walks bottom → top, notch biting right.
    for (const [u, v] of notchPts) pts.push([c(0, v), c(1, -stub - u)]);
  }
  return pts;
}

function cssCoord(k: Coord): string {
  if (k.f === 0) return `${k.o}px`;
  if (k.o === 0) return "100%";
  return k.o < 0 ? `calc(100% - ${-k.o}px)` : `calc(100% + ${k.o}px)`;
}

/** `polygon(...)` for CSS clip-path; resolves against the element's own box. */
export function ticketClipPathCss(opts: TicketShapeOptions): string {
  return `polygon(${ticketShape(opts)
    .map(([x, y]) => `${cssCoord(x)} ${cssCoord(y)}`)
    .join(", ")})`;
}

/**
 * `polygon(...)` in absolute px for a fixed-size box (satori / next/og).
 * `dx`/`dy` shift the outline — e.g. to clip a child that sits at (−dx, −dy)
 * inside the ticket with the ticket's own silhouette.
 */
export function ticketClipPathPx(opts: TicketShapeOptions, width: number, height: number, dx = 0, dy = 0): string {
  return `polygon(${ticketShape(opts)
    .map(([x, y]) => `${x.f * width + x.o + dx}px ${y.f * height + y.o + dy}px`)
    .join(", ")})`;
}
