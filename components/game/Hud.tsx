"use client";

import { MISS, TIERS, type Outcome } from "@/lib/game/tiers";
import { TierSquare } from "./TierChip";
import styles from "./Hud.module.css";
import { useCountUp } from "./useCountUp";

export interface HudProps {
  distance: number;
  points: number;
  /** Outcome per round so far (revealed rounds only). */
  outcomes: (Outcome | null)[];
  /** 0-based index of the round in play, or null. */
  current: number | null;
  total: number;
}

export default function Hud({ distance, outcomes, current, total }: HudProps) {
  const d = useCountUp(distance, 600);
  const roundNo = current === null ? Math.min(total, outcomes.filter(Boolean).length + 1) : current + 1;
  return (
    <header className={styles.hud}>
      <div className={`px-panel ${styles.panel}`}>
        <span className={styles.label}>FROM THE STAGE</span>
        <span className={styles.distance} aria-live="off">
          {d === 0 ? "0m" : `${d}m`}
        </span>
        <span className="sr-only">{distance} metres from the stage</span>
      </div>
      <div className={styles.progress}>
        <div className={styles.squares}>
          {Array.from({ length: total }, (_, i) => {
            const o = outcomes[i] ?? null;
            const label = o ? `Prompt ${i + 1}: ${o === "miss" ? MISS.label : TIERS[o].label}` : undefined;
            return <TierSquare key={i} outcome={o} current={i === current && !o} label={label} />;
          })}
        </div>
        <span className={styles.count}>
          PROMPT {roundNo} OF {total}
        </span>
      </div>
    </header>
  );
}
