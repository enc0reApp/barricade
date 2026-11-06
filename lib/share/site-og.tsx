/**
 * The site-wide OG image: a pixel night festival seen from the back of the
 * field, built from satori boxes. 1200×630.
 *
 * satori notes (verified): gradient backgrounds are not clipped by clip-path,
 * and a clip-path nested inside a clipped parent is ignored — so every shape
 * here is a plain box, a rotated box, or a solid clipped sibling.
 */

import type { ReactElement } from "react";
import { ImageResponse } from "next/og";
import { ROUNDS_PER_SET, START_DISTANCE } from "../game/tiers";
import { NIGHT } from "./colors";
import { OG_FONT, loadOgFonts } from "./og-fonts";
import { Box, Stars, makeStars, seeded } from "./og-parts";

export const SITE_OG_SIZE = { width: 1200, height: 630 } as const;

const W = SITE_OG_SIZE.width;
const H = SITE_OG_SIZE.height;
const HORIZON = 438;
const STAGE = { x: 396, w: 408, roof: 300 };

function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

function Beam({ x, y, angle, color, width = 42, length = 560 }: { x: number; y: number; angle: number; color: string; width?: number; length?: number }): ReactElement {
  return (
    <div
      style={{
        position: "absolute",
        left: x - width / 2,
        top: y - length,
        width,
        height: length,
        display: "flex",
        transformOrigin: "50% 100%",
        transform: `rotate(${angle}deg)`,
        backgroundImage: `linear-gradient(0deg, ${rgba(color, 0.55)} 0%, ${rgba(color, 0.18)} 45%, ${rgba(color, 0)} 100%)`,
      }}
    />
  );
}

function Stage(): ReactElement {
  const { x, w, roof } = STAGE;
  const dark = "#070915";
  const truss = "#1c2350";
  const led = { x: x + 54, y: roof + 24, w: w - 108, h: 90 };
  const cols = Math.floor(led.w / 6);
  const rows = Math.floor(led.h / 6);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, display: "flex" }}>
      {/* LED wall: stage-light gradient behind a 6px tile grid */}
      <Box
        {...led}
        style={{
          backgroundImage: `linear-gradient(90deg, ${NIGHT.magenta} 0%, ${NIGHT.uv} 45%, ${NIGHT.cyan} 100%)`,
        }}
      />
      {Array.from({ length: cols - 1 }, (_, i) => (
        <Box key={`c${i}`} x={led.x + (i + 1) * 6} y={led.y} w={1} h={led.h} style={{ background: dark, opacity: 0.45 }} />
      ))}
      {Array.from({ length: rows - 1 }, (_, i) => (
        <Box key={`r${i}`} x={led.x} y={led.y + (i + 1) * 6} w={led.w} h={1} style={{ background: dark, opacity: 0.45 }} />
      ))}
      {/* LED content: a chunky pixel equaliser */}
      {Array.from({ length: 16 }, (_, i) => {
        const r = seeded(91 + i)();
        const bh = 12 + Math.floor(r * 9) * 6;
        return <Box key={`e${i}`} x={led.x + 12 + i * 18} y={led.y + led.h - 6 - bh} w={12} h={bh} style={{ background: "#f1eee8", opacity: 0.35 }} />;
      })}
      {/* truss: roof + legs */}
      <Box x={x} y={roof} w={w} h={12} style={{ background: truss }} />
      <Box x={x} y={roof} w={12} h={HORIZON - roof} style={{ background: truss }} />
      <Box x={x + w - 12} y={roof} w={12} h={HORIZON - roof} style={{ background: truss }} />
      {Array.from({ length: 33 }, (_, i) => (
        <Box key={`t${i}`} x={x + 6 + i * 12} y={roof + 3} w={6} h={6} style={{ background: dark }} />
      ))}
      {/* lamps on the roof */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Box key={`l${i}`} x={x + 30 + i * 66} y={roof + 12} w={12} h={6} style={{ background: i % 2 ? NIGHT.cyan : NIGHT.amber }} />
      ))}
      {/* PA hangs */}
      {[x + 18, x + w - 42].map((px, k) => (
        <div key={`pa${k}`} style={{ position: "absolute", left: px, top: roof + 18, width: 24, height: 84, display: "flex", flexDirection: "column" }}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} style={{ width: 24 - i * 2, height: 12, marginLeft: k === 0 ? 0 : i * 2, marginBottom: 2, background: "#0b0e1f", display: "flex" }} />
          ))}
        </div>
      ))}
      {/* deck + DJ booth + DJ */}
      <Box x={x - 12} y={HORIZON - 24} w={w + 24} h={24} style={{ background: dark }} />
      <Box x={x + w / 2 - 36} y={HORIZON - 48} w={72} h={24} style={{ background: dark }} />
      <Box x={x + w / 2 - 6} y={HORIZON - 66} w={12} h={12} style={{ background: dark }} />
      <Box x={x + w / 2 - 12} y={HORIZON - 54} w={24} h={8} style={{ background: dark }} />
      <Box x={x + w / 2 + 12} y={HORIZON - 78} w={6} h={24} style={{ background: dark }} />
    </div>
  );
}

interface Person {
  x: number;
  base: number;
  u: number;
  hand: -1 | 0 | 1;
  phone: boolean;
}

function crowdRow(seed: number, base: number, u: number, spacing: number, jitter: number): Person[] {
  const r = seeded(seed);
  const people: Person[] = [];
  for (let x = -u; x < W + u; x += spacing + Math.floor(r() * 3) * (u / 2)) {
    const roll = r();
    people.push({
      x: Math.round(x / 3) * 3,
      base: base + Math.floor(r() * jitter) * 3,
      u,
      hand: roll > 0.86 ? 1 : roll > 0.78 ? -1 : 0,
      phone: r() > 0.5,
    });
  }
  return people;
}

function CrowdRow({ people, color, height }: { people: Person[]; color: string; height: number }): ReactElement {
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, display: "flex" }}>
      {people.map((p, i) => {
        const head = p.u * 2;
        const shoulders = p.u * 5;
        const headY = p.base - head;
        const arm = p.hand !== 0;
        const armX = p.hand === 1 ? p.x + shoulders - p.u : p.x;
        const hx = p.x + (shoulders - head) / 2;
        const c = Math.max(1, Math.round(p.u / 3)); // rounded-corner step
        const neck = Math.max(1, Math.round(p.u / 2));
        const top = p.base;
        return (
          <div key={i} style={{ position: "absolute", left: 0, top: 0, width: W, height: H, display: "flex" }}>
            {/* head: a square with its corners knocked off */}
            <Box x={hx + c} y={headY - neck} w={head - 2 * c} h={head} style={{ background: color }} />
            <Box x={hx} y={headY - neck + c} w={head} h={head - 2 * c} style={{ background: color }} />
            {/* neck */}
            <Box x={hx + p.u / 2} y={headY - neck + head - 1} w={p.u} h={neck + 2} style={{ background: color }} />
            {/* shoulders, rounded at the top */}
            <Box x={p.x + c * 2} y={top} w={shoulders - c * 4} h={c + 1} style={{ background: color }} />
            <Box x={p.x + c} y={top + c} w={shoulders - c * 2} h={c + 1} style={{ background: color }} />
            <Box x={p.x} y={top + c * 2} w={shoulders} h={height} style={{ background: color }} />
            {arm ? <Box x={armX} y={headY - p.u * 3} w={p.u} h={p.u * 4 + c * 2} style={{ background: color }} /> : null}
            {arm && p.phone ? (
              <Box x={armX} y={headY - p.u * 4} w={p.u} h={Math.max(3, Math.round(p.u * 1.2))} style={{ background: "#e9fbff" }} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Ruler(): ReactElement {
  const x = 1110;
  const top = 132;
  const step = 30; // px per 50m
  const marks = Array.from({ length: START_DISTANCE / 50 + 1 }, (_, i) => i * 50);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, display: "flex" }}>
      <Box x={x} y={top} w={3} h={step * (START_DISTANCE / 50) + 3} style={{ background: NIGHT.inkFaint }} />
      {marks.map((m, i) => (
        <Box key={m} x={x} y={top + i * step} w={m % 100 === 0 ? 15 : 9} h={3} style={{ background: NIGHT.inkFaint }} />
      ))}
      {marks
        .filter((m) => m % 100 === 0)
        .map((m) => (
          <div
            key={`t${m}`}
            style={{
              position: "absolute",
              left: x + 21,
              top: top + (m / 50) * step - 8,
              display: "flex",
              fontFamily: OG_FONT.mono,
              fontSize: 14,
              color: NIGHT.inkDim,
            }}
          >
            {`${m}m`}
          </div>
        ))}
      {/* YOU ▶ at 500m — the triangle is stacked pixel rows (▶ isn't in Geist Pixel) */}
      <div style={{ position: "absolute", left: x - 70, top: top + (START_DISTANCE / 50) * step - 9, display: "flex", alignItems: "center" }}>
        <div style={{ display: "flex", fontFamily: OG_FONT.pixel, fontSize: 20, color: NIGHT.magenta, letterSpacing: 2, marginRight: 6 }}>YOU</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {[3, 6, 9, 12, 9, 6, 3].map((w, i) => (
            <div key={i} style={{ width: w, height: 3, background: NIGHT.magenta, display: "flex" }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SiteOgImage(): ReactElement {
  const word = "BARRICADE";
  const wordStyle = { fontSize: 158, letterSpacing: 10, lineHeight: 1 } as const;
  const stars = makeStars({
    seed: 2026,
    count: 110,
    area: { x: 0, y: 0, w: W, h: HORIZON - 40 },
    grid: 3,
    avoid: [{ x: 160, y: 40, w: 880, h: 210 }],
    colors: [NIGHT.ink, NIGHT.ink, NIGHT.ink, NIGHT.cyan, NIGHT.amber],
  });
  const back = crowdRow(7, HORIZON + 12, 3, 12, 3);
  const mid = crowdRow(11, HORIZON + 66, 6, 27, 4);
  const front = crowdRow(23, H - 54, 12, 54, 4);

  return (
    <div
      style={{
        width: W,
        height: H,
        display: "flex",
        position: "relative",
        backgroundColor: NIGHT.sky0,
        backgroundImage: `linear-gradient(180deg, ${NIGHT.sky0} 0%, ${NIGHT.sky1} 30%, ${NIGHT.sky2} 58%, ${NIGHT.sky3} 70%, ${NIGHT.field1} 70%, ${NIGHT.field0} 100%)`,
        fontFamily: OG_FONT.pixel,
        color: NIGHT.ink,
        overflow: "hidden",
      }}
    >
      <Stars stars={stars} />
      {/* haze over the stage */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: W,
          height: H,
          display: "flex",
          backgroundImage: `radial-gradient(ellipse 42% 34% at 50% 66%, ${rgba(NIGHT.uv, 0.6)} 0%, ${rgba(NIGHT.magenta, 0.18)} 55%, ${rgba(NIGHT.magenta, 0)} 100%)`,
        }}
      />
      <Beam x={STAGE.x + 60} y={STAGE.roof + 12} angle={-34} color={NIGHT.cyan} />
      <Beam x={STAGE.x + 168} y={STAGE.roof + 12} angle={-12} color={NIGHT.magenta} width={36} />
      <Beam x={STAGE.x + 240} y={STAGE.roof + 12} angle={13} color={NIGHT.amber} width={36} />
      <Beam x={STAGE.x + 348} y={STAGE.roof + 12} angle={33} color={NIGHT.uv} />
      <Stage />
      {/* low fog */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: HORIZON - 36,
          width: W,
          height: 60,
          display: "flex",
          backgroundImage: `linear-gradient(180deg, rgba(241,238,232,0) 0%, rgba(200,190,255,0.16) 55%, rgba(241,238,232,0) 100%)`,
        }}
      />
      <CrowdRow people={back} color="#151a3e" height={60} />
      <CrowdRow people={mid} color="#0b0e24" height={90} />
      {/* a flag on a pole, mid crowd */}
      <Box x={264} y={HORIZON - 30} w={3} h={96} style={{ background: "#0b0e24" }} />
      <Box x={267} y={HORIZON - 30} w={36} h={24} style={{ background: NIGHT.magenta, opacity: 0.85 }} />
      <Box x={267} y={HORIZON - 18} w={36} h={6} style={{ background: NIGHT.amber, opacity: 0.85 }} />
      <CrowdRow people={front} color="#03040a" height={80} />

      <Ruler />

      {/* wordmark with a cyan/magenta chromatic split */}
      <div style={{ position: "absolute", left: 0, top: 54, width: W, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ display: "flex", position: "relative" }}>
          <div style={{ ...wordStyle, position: "absolute", left: -3, top: 0, color: NIGHT.magenta }}>{word}</div>
          <div style={{ ...wordStyle, position: "absolute", left: 3, top: 0, color: NIGHT.cyan }}>{word}</div>
          <div style={{ ...wordStyle, position: "relative", color: NIGHT.ink }}>{word}</div>
        </div>
        <div style={{ display: "flex", marginTop: 18, fontSize: 26, letterSpacing: 9, color: NIGHT.ink }}>THE DAILY PUSH</div>
      </div>

      {/* tagline panel over the crowd */}
      <div style={{ position: "absolute", left: 0, top: H - 92, width: W, display: "flex", justifyContent: "center" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "14px 26px 12px",
            background: rgba(NIGHT.panel, 0.9),
            border: `3px solid ${NIGHT.panelEdge}`,
            fontSize: 26,
            letterSpacing: 2,
            color: NIGHT.ink,
          }}
        >
          <div style={{ display: "flex" }}>{ROUNDS_PER_SET} prompts</div>
          <div style={{ display: "flex", color: NIGHT.magenta, margin: "0 16px" }}>·</div>
          <div style={{ display: "flex" }}>rarer answers get you closer</div>
          <div style={{ display: "flex", color: NIGHT.magenta, margin: "0 16px" }}>·</div>
          <div style={{ display: "flex", color: NIGHT.cyan }}>fstvl.xyz</div>
        </div>
      </div>
    </div>
  );
}

export async function siteImageResponse(): Promise<ImageResponse> {
  return new ImageResponse(<SiteOgImage />, {
    ...SITE_OG_SIZE,
    fonts: await loadOgFonts(["pixel", "mono"]),
  });
}
