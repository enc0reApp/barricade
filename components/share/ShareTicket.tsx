/**
 * The ticket stub (docs/DESIGN.md §3) as HTML — same look as the OG image.
 * Server-safe (no hooks), so the results screen can reuse it too.
 *
 * Landscape when its container is ≥ 600px wide, otherwise portrait with the
 * stub at the bottom. The notched silhouette is a clip-path built by
 * lib/share/ticket-shape.ts.
 */

import type { CSSProperties } from "react";
import { type Outcome, MISS, TIERS, distanceFor, outcomePoints } from "@/lib/game/tiers";
import { barcode } from "@/lib/share/barcode";
import { encodeShareCode } from "@/lib/share/code";
import { ticketDate } from "@/lib/share/lore";
import { ticketClipPathCss } from "@/lib/share/ticket-shape";
import { zoneFor } from "@/lib/share/zone";
import styles from "./ShareTicket.module.css";

export interface ShareTicketProps {
  number: number;
  outcomes: readonly Outcome[];
  /** YYYY-MM-DD; omitted when unknown. */
  date?: string | null;
  /** % of the crowd beaten, when known. */
  beatPct?: number | null;
  className?: string;
}

/* Keep in sync with ShareTicket.module.css (--stub-w / --stub-h). */
const STUB_W = 232;
const STUB_H = 148;
const STEP = 4;

const CLIP_LANDSCAPE = ticketClipPathCss({ orientation: "landscape", stub: STUB_W, step: STEP, notch: 4, corner: 2 });
const CLIP_PORTRAIT = ticketClipPathCss({ orientation: "portrait", stub: STUB_H, step: STEP, notch: 4, corner: 2 });

function label(o: Outcome): string {
  return o === "miss" ? MISS.label : TIERS[o].label;
}

function Barcode({ code }: { code: string }) {
  const { length, bars } = barcode(code);
  const h = 22;
  return (
    <svg
      className={styles.barcode}
      viewBox={`0 0 ${length} ${h + 3}`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {bars.map((b) => (
        <rect key={b.x} x={b.x} y={0} width={b.w} height={b.guard ? h + 3 : h} />
      ))}
    </svg>
  );
}

export function ShareTicket({ number, outcomes, date, beatPct, className }: ShareTicketProps) {
  const distance = distanceFor(outcomes, outcomes.length);
  const points = outcomes.reduce((s, o) => s + outcomePoints(o), 0);
  const code = encodeShareCode(number, outcomes);
  const dateLabel = date ? ticketDate(date) : "";
  const hasBeat = typeof beatPct === "number" && Number.isFinite(beatPct);
  const summary =
    `BARRICADE set #${number} ticket. ` +
    (distance === 0 ? "On the barricade. " : `${distance} metres from the stage. `) +
    `${points} points.` +
    (hasBeat ? ` Beat ${Math.round(beatPct)}% of the crowd.` : "");

  const vars = {
    "--clip-landscape": CLIP_LANDSCAPE,
    "--clip-portrait": CLIP_PORTRAIT,
  } as CSSProperties;

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(" ")} style={vars}>
      <div className={styles.shadow}>
        <article className={styles.ticket} aria-label={summary}>
          <div className={styles.main}>
            <header className={styles.head}>
              <span className={styles.wordmark}>BARRICADE</span>
              <span className={styles.setTag}>SET #{number}</span>
            </header>
            <div className={styles.meta}>
              <span>{dateLabel || "THE DAILY PUSH"}</span>
              <span className={styles.ga}>GENERAL ADMISSION</span>
            </div>
            <div className={styles.dashes} aria-hidden="true" />

            <div className={styles.distanceBlock}>
              {distance === 0 ? (
                <p className={styles.barricade}>
                  <span>ON THE</span> <span>BARRICADE</span>
                </p>
              ) : (
                <p className={styles.distance}>
                  {distance}
                  <span className={styles.unit}>m</span>
                </p>
              )}
              <p className={styles.from}>{distance === 0 ? "0m FROM THE STAGE" : "FROM THE STAGE"}</p>
            </div>

            <div className={styles.foot}>
              <ol className={styles.squares} aria-label="Rounds">
                {outcomes.map((o, i) => {
                  const pts = outcomePoints(o);
                  return (
                    <li key={i} className={styles.square} title={`Round ${i + 1}: ${label(o)}${pts ? ` +${pts}` : ""}`}>
                      <span
                        className={styles.chip}
                        style={{ background: o === "miss" ? "var(--tier-miss)" : `var(--tier-${o})` }}
                        aria-hidden="true"
                      />
                      <span className={styles.pts}>{pts > 0 ? `+${pts}` : "—"}</span>
                      <span className="sr-only">{`Round ${i + 1}: ${label(o)}`}</span>
                    </li>
                  );
                })}
              </ol>
              <div className={styles.points}>
                {hasBeat ? <span className={styles.label}>BEAT {Math.round(beatPct)}% OF THE CROWD</span> : null}
                <span className={styles.label}>POINTS</span>
                <strong className={styles.pointsValue}>{points}</strong>
              </div>
            </div>
          </div>

          <div className={styles.perf} aria-hidden="true" />

          <div className={styles.stub}>
            {/* One span per letter so landscape can stack them upright. The gap
                keeps a real space, so the text reads "ADMIT ONE" when copied or
                extracted, and a fixed size so it can't collapse. */}
            <div className={styles.admit} aria-hidden="true">
              {"ADMIT ONE".split("").map((ch, i) => (
                <span key={i} className={ch === " " ? styles.admitGap : undefined}>
                  {ch}
                </span>
              ))}
            </div>
            <div className={styles.stubBody}>
              <div className={styles.stubSet}>
                <span className={styles.label}>SET</span>
                <span className={styles.stubNumber}>#{number}</span>
              </div>
              <div className={styles.stubZone}>
                <span className={styles.label}>ZONE</span>
                <span className={styles.zone}>{zoneFor(distance)}</span>
              </div>
              <div className={styles.stubCode}>
                <Barcode code={code} />
                <span className={styles.code}>{code.toUpperCase()}</span>
                <span className={styles.site}>fstvl.xyz</span>
              </div>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
