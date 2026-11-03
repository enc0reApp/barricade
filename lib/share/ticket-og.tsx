/**
 * The share ticket (docs/DESIGN.md §3) as satori JSX for next/og.
 * Flexbox + absolute boxes only — satori renders a CSS subset.
 *
 *   return ticketImageResponse({ number, outcomes, date });
 */

import type { ReactElement } from "react";
import { ImageResponse } from "next/og";
import { type Outcome, distanceFor, outcomePoints } from "../game/tiers";
import { barcode } from "./barcode";
import { encodeShareCode } from "./code";
import { INK, INK_SOFT, NIGHT, PAPER, PAPER_SHADE, outcomeHex } from "./colors";
import { ticketDate } from "./lore";
import { OG_FONT, loadOgFonts } from "./og-fonts";
import { Stars, makeStars } from "./og-parts";
import { ticketClipPathPx } from "./ticket-shape";
import { zoneFor } from "./zone";
import { fnv1a } from "./rng";

export const TICKET_OG_SIZE = { width: 1200, height: 630 } as const;

export interface TicketOgProps {
  number: number;
  outcomes: readonly Outcome[];
  /** YYYY-MM-DD, or null/undefined to omit the date line. */
  date?: string | null;
  /** % of the crowd beaten, when known (results screen). */
  beatPct?: number | null;
}

/* Geometry (px). Everything snaps to a 6px pixel step. */
const STEP = 6;
const T = { x: 54, y: 54, w: 1092, h: 522 };
const STUB = 300;
const SHAPE = { orientation: "landscape" as const, stub: STUB, step: STEP, notch: 5, corner: 2 };
const CLIP = ticketClipPathPx(SHAPE, T.w, T.h);
const STUB_CLIP = ticketClipPathPx(SHAPE, T.w, T.h, -(T.w - STUB), 0);

function Wordmark({ size, color = INK }: { size: number; color?: string }): ReactElement {
  const base = { fontSize: size, letterSpacing: Math.round(size * 0.06), lineHeight: 1 } as const;
  const split = Math.max(2, Math.round(size / 18));
  return (
    <div style={{ display: "flex", position: "relative" }}>
      <div style={{ ...base, position: "absolute", left: -split, top: 0, color: NIGHT.magenta }}>BARRICADE</div>
      <div style={{ ...base, position: "absolute", left: split, top: 0, color: NIGHT.cyan }}>BARRICADE</div>
      <div style={{ ...base, position: "relative", color }}>BARRICADE</div>
    </div>
  );
}

function Dashes({ width, dash = 12, gap = 6, h = 3, color = INK }: { width: number; dash?: number; gap?: number; h?: number; color?: string }): ReactElement {
  const n = Math.floor((width + gap) / (dash + gap));
  return (
    <div style={{ display: "flex", width, height: h }}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ width: dash, height: h, marginRight: i < n - 1 ? gap : 0, background: color, opacity: 0.55 }} />
      ))}
    </div>
  );
}

function BarcodeOg({ code, unit = 3, height = 60 }: { code: string; unit?: number; height?: number }): ReactElement {
  const { length, bars } = barcode(code);
  return (
    <div style={{ display: "flex", position: "relative", width: length * unit, height: height + unit * 4 }}>
      {bars.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: b.x * unit,
            top: 0,
            width: b.w * unit,
            height: b.guard ? height + unit * 4 : height,
            background: INK,
          }}
        />
      ))}
    </div>
  );
}

function TierSquare({ outcome, size }: { outcome: Outcome; size: number }): ReactElement {
  const pts = outcomePoints(outcome);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginRight: 12 }}>
      <div
        style={{
          display: "flex",
          width: size,
          height: size,
          background: outcomeHex(outcome),
          border: `4px solid ${INK}`,
          boxShadow: `4px 4px 0 0 ${INK}`,
        }}
      />
      <div style={{ display: "flex", marginTop: 10, fontFamily: OG_FONT.mono, fontWeight: 500, fontSize: 15, color: INK_SOFT }}>
        {pts > 0 ? `+${pts}` : "—"}
      </div>
    </div>
  );
}

/** The paper ticket itself, T.w × T.h, cut to its notched silhouette. */
export function TicketOg({ number, outcomes, date, beatPct }: TicketOgProps): ReactElement {
  const distance = distanceFor(outcomes);
  const points = outcomes.reduce((s, o) => s + outcomePoints(o), 0);
  const code = encodeShareCode(number, outcomes);
  const dateLabel = date ? ticketDate(date) : "";
  const mainW = T.w - STUB;
  const perfDots = Math.floor((T.h - 2 * (SHAPE.notch * STEP + 18)) / 15);
  // "#12" fits the stub at 79px; longer set numbers step down on the font's grid.
  const digits = String(number).length;
  const stubNumberSize = digits <= 3 ? 79 : digits === 4 ? 66 : 53;

  // satori ignores a clip-path nested inside a clipped parent, so the paper
  // and the stub's shade are clipped siblings and the content sits on top.
  return (
    <div
      style={{
        position: "absolute",
        left: T.x,
        top: T.y,
        width: T.w,
        height: T.h,
        display: "flex",
        color: INK,
        fontFamily: OG_FONT.pixel,
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, width: T.w, height: T.h, display: "flex", background: PAPER, clipPath: CLIP }} />
      <div
        style={{
          position: "absolute",
          left: mainW,
          top: 0,
          width: STUB,
          height: T.h,
          display: "flex",
          background: PAPER_SHADE,
          clipPath: STUB_CLIP,
        }}
      />
      {/* MAIN */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: mainW,
          height: T.h,
          padding: "40px 46px 34px 48px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <Wordmark size={53} />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <div
                style={{
                  display: "flex",
                  background: INK,
                  color: PAPER,
                  fontSize: 26,
                  letterSpacing: 3,
                  padding: "9px 14px 7px 16px",
                }}
              >
                {`SET #${number}`}
              </div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 14,
              fontFamily: OG_FONT.mono,
              fontWeight: 500,
              fontSize: 18,
              letterSpacing: 3,
              color: INK_SOFT,
            }}
          >
            <div style={{ display: "flex" }}>{dateLabel || "THE DAILY PUSH"}</div>
            <div style={{ display: "flex" }}>GENERAL ADMISSION</div>
          </div>
          <div style={{ display: "flex", marginTop: 18 }}>
            <Dashes width={mainW - 94} />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {distance === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", fontSize: 92, lineHeight: 0.98, letterSpacing: 2 }}>
              <div style={{ display: "flex" }}>ON THE</div>
              <div style={{ display: "flex" }}>BARRICADE</div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "baseline", lineHeight: 0.86 }}>
              <div style={{ display: "flex", fontSize: 211, letterSpacing: -4 }}>{String(distance)}</div>
              <div style={{ display: "flex", fontSize: 105, marginLeft: 6 }}>m</div>
            </div>
          )}
          <div style={{ display: "flex", marginTop: 16, fontSize: 26, letterSpacing: 9 }}>
            {distance === 0 ? "0m FROM THE STAGE" : "FROM THE STAGE"}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex" }}>
            {outcomes.map((o, i) => (
              <TierSquare key={i} outcome={o} size={40} />
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", fontFamily: OG_FONT.mono, fontWeight: 500, fontSize: 15, letterSpacing: 4, color: INK_SOFT }}>
              {typeof beatPct === "number" ? `BEAT ${Math.round(beatPct)}% OF THE CROWD` : "POINTS"}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", marginTop: 6 }}>
              {typeof beatPct === "number" ? (
                <div style={{ display: "flex", fontFamily: OG_FONT.mono, fontSize: 15, letterSpacing: 4, color: INK_SOFT, marginRight: 12 }}>
                  POINTS
                </div>
              ) : null}
              <div style={{ display: "flex", fontSize: 53, lineHeight: 1 }}>{String(points)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* PERFORATION */}
      <div
        style={{
          position: "absolute",
          left: mainW - 3,
          top: SHAPE.notch * STEP + 18,
          width: 6,
          height: perfDots * 15,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {Array.from({ length: perfDots }, (_, i) => (
          <div key={i} style={{ width: 6, height: 6, marginBottom: 9, background: INK, opacity: 0.4 }} />
        ))}
      </div>

      {/* STUB */}
      <div
        style={{
          display: "flex",
          width: STUB,
          height: T.h,
          padding: "40px 30px 34px 30px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: 30,
            marginRight: 24,
            fontSize: 26,
            lineHeight: 1,
          }}
        >
          {"ADMIT ONE".split("").map((ch, i) => (
            <div key={i} style={{ display: "flex", height: ch === " " ? 22 : 34 }}>
              {ch === " " ? "" : ch}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flexGrow: 1 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontFamily: OG_FONT.mono, fontWeight: 500, fontSize: 15, letterSpacing: 4, color: INK_SOFT }}>
              SET
            </div>
            <div style={{ display: "flex", fontSize: stubNumberSize, lineHeight: 1, marginTop: 6 }}>{`#${number}`}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontFamily: OG_FONT.mono, fontWeight: 500, fontSize: 15, letterSpacing: 4, color: INK_SOFT }}>
              ZONE
            </div>
            <div style={{ display: "flex", fontSize: 26, letterSpacing: 2, marginTop: 8 }}>{zoneFor(distance)}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <BarcodeOg code={code} />
            <div style={{ display: "flex", marginTop: 10, fontFamily: OG_FONT.mono, fontWeight: 500, fontSize: 14, letterSpacing: 3, color: INK_SOFT }}>
              {code.toUpperCase()}
            </div>
            <div style={{ display: "flex", marginTop: 14, fontSize: 26, letterSpacing: 2 }}>fstvl.xyz</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Full 1200×630 composition: the ticket lying in the night field. */
export function TicketOgImage(props: TicketOgProps): ReactElement {
  const code = encodeShareCode(props.number, props.outcomes);
  const stars = makeStars({
    seed: fnv1a(code),
    count: 70,
    area: { x: 0, y: 0, w: TICKET_OG_SIZE.width, h: TICKET_OG_SIZE.height },
    grid: 3,
    avoid: [{ x: T.x - 6, y: T.y - 6, w: T.w + 30, h: T.h + 30 }],
    colors: [NIGHT.ink, NIGHT.ink, NIGHT.cyan, NIGHT.amber],
  });
  return (
    <div
      style={{
        width: TICKET_OG_SIZE.width,
        height: TICKET_OG_SIZE.height,
        display: "flex",
        position: "relative",
        backgroundColor: NIGHT.sky0,
        backgroundImage: `radial-gradient(ellipse 70% 60% at 50% 100%, rgba(139,92,255,0.45), rgba(139,92,255,0) 70%), linear-gradient(180deg, ${NIGHT.sky1} 0%, ${NIGHT.sky2} 100%)`,
        fontFamily: OG_FONT.pixel,
      }}
    >
      <Stars stars={stars} />
      {/* stage-light glow + hard pixel shadow */}
      <div
        style={{
          position: "absolute",
          left: T.x,
          top: T.y,
          width: T.w,
          height: T.h,
          display: "flex",
          boxShadow: `0 0 70px 6px rgba(69,229,255,0.28)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: T.x + 12,
          top: T.y + 12,
          width: T.w,
          height: T.h,
          display: "flex",
          background: NIGHT.magenta,
          clipPath: CLIP,
        }}
      />
      <TicketOg {...props} />
    </div>
  );
}

export async function ticketImageResponse(props: TicketOgProps): Promise<ImageResponse> {
  return new ImageResponse(<TicketOgImage {...props} />, {
    ...TICKET_OG_SIZE,
    fonts: await loadOgFonts(["pixel", "mono", "monoMedium"]),
  });
}
