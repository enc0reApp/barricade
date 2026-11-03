import { MISS, TIERS, type Outcome } from "@/lib/game/tiers";
import styles from "./TierChip.module.css";

/** A tier label on its colour. Never colour-only: the label is always there. */
export default function TierChip({ outcome, points = false, size = "md" }: { outcome: Outcome; points?: boolean; size?: "sm" | "md" }) {
  const label = outcome === "miss" ? MISS.label : TIERS[outcome].label;
  const pts = outcome === "miss" ? 0 : TIERS[outcome].points;
  return (
    <span className={`${styles.chip} ${styles[size]}`} data-tier={outcome}>
      {label}
      {points && outcome !== "miss" ? <span className={styles.pts}>+{pts}</span> : null}
    </span>
  );
}

/** A small filled square in a tier colour (progress, tickets, archive rows). */
export function TierSquare({ outcome, label, current = false }: { outcome: Outcome | null; label?: string; current?: boolean }) {
  return (
    <span
      className={styles.square}
      data-tier={outcome ?? "empty"}
      data-current={current || undefined}
      title={label}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    />
  );
}
