/**
 * Share-page copy: the headline and the lore marker for a distance.
 * The marker table mirrors the distance ruler in docs/DESIGN.md.
 */

import { START_DISTANCE } from "../game/tiers";

export const LORE_MARKERS: Readonly<Record<number, string>> = {
  700: "the car park. you can hear it from here",
  650: "wristband scanners",
  600: "the merch line (90 minutes, minimum)",
  550: "portaloo row. hold your breath",
  500: "the car park. you can hear it from here",
  450: "wristband scanners",
  400: "the merch line (90 minutes, minimum)",
  350: "portaloo row. hold your breath",
  300: "front-of-house. best mix in the field",
  250: 'the "excuse me, sorry" zone',
  200: "someone's on someone's shoulders",
  150: "the circle pit opens here",
  100: "crowd-surfers incoming",
  50: "camped out since 6am",
  0: "THE BARRICADE. you made it.",
};

/** The marker you reached: the nearest one at or behind you (14m → the 50m marker). */
export function loreFor(distance: number): string {
  const d = Math.min(START_DISTANCE, Math.max(0, distance));
  const key = Math.ceil(d / 50) * 50;
  return LORE_MARKERS[key] ?? LORE_MARKERS[START_DISTANCE]!;
}

/** "Someone got 14m from the stage." — third person, for people who weren't there. */
export function shareHeadline(distance: number): string {
  if (distance <= 0) return "Someone made it to the barricade.";
  if (distance >= START_DISTANCE) return "Someone never left the car park.";
  return `Someone got ${distance}m from the stage.`;
}

/** "FRI 20 NOV 2026" from YYYY-MM-DD (calendar date, no time zone involved). */
export function ticketDate(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const wd = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getUTCDay()]!;
  const mo = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getUTCMonth()]!;
  return `${wd} ${String(d.getUTCDate()).padStart(2, "0")} ${mo} ${d.getUTCFullYear()}`;
}
