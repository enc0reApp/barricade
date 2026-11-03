import { LORE_MARKERS, loreFor } from "@/lib/share/lore";
import { START_DISTANCE } from "@/lib/game/tiers";
import styles from "./Ruler.module.css";

export interface RulerProps {
  /** Metres from the stage. The YOU marker glides there. */
  distance: number;
  /**
   * "all": every lore marker, dim (wide screens).
   * "near": only the marker you're at, beside YOU.
   * "none": ticks only.
   */
  lore?: "all" | "near" | "none";
}

const TICKS = Array.from({ length: START_DISTANCE / 50 + 1 }, (_, i) => i * 50);

/** Vertical distance ruler on the right edge: 0m (the stage) at the top, 700m at the bottom. */
export default function Ruler({ distance, lore = "near" }: RulerProps) {
  const d = Math.max(0, Math.min(START_DISTANCE, distance));
  const pct = (m: number) => `${(m / START_DISTANCE) * 100}%`;
  return (
    <div className={styles.ruler} aria-hidden="true" data-lore={lore}>
      <div className={styles.track}>
        <div className={styles.line} />
        {TICKS.map((m) => (
          <div key={m} className={m % 100 === 0 ? styles.tickMajor : styles.tick} style={{ top: pct(m) }}>
            {m % 100 === 0 && Math.abs(m - d) > 28 ? <span className={styles.label}>{m}m</span> : null}
            {lore === "all" ? <span className={styles.lore}>{LORE_MARKERS[m]}</span> : null}
          </div>
        ))}
        <div className={styles.you} style={{ top: pct(d) }}>
          <span className={styles.youLabel}>YOU</span>
          <svg className={styles.youArrow} viewBox="0 0 4 7" width="8" height="14" shapeRendering="crispEdges">
            <path d="M0 0h1v7H0zM1 1h1v5H1zM2 2h1v3H2zM3 3h1v1H3z" fill="currentColor" />
          </svg>
          {lore === "near" ? <span className={styles.youLore}>{loreFor(d)}</span> : null}
        </div>
      </div>
    </div>
  );
}
