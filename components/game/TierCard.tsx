import type { AcceptedAnswer } from "@/lib/api/contract";
import { flavourFor } from "@/lib/client/flavour";
import { formatShare } from "@/lib/client/format";
import { TIERS, type Outcome } from "@/lib/game/tiers";
import styles from "./TierCard.module.css";

/** The end of the reveal: what tier it landed in, how far it carried you. */
export default function TierCard({ outcome, answer, seed }: { outcome: Outcome; answer: AcceptedAnswer | null; seed: string }) {
  if (outcome === "miss" || !answer) {
    return (
      <div className={`px-panel ${styles.card}`} data-tier="miss" role="status" aria-live="polite">
        <p className={styles.tier}>TIME&apos;S UP.</p>
        <p className={styles.flavour}>the crowd didn&apos;t budge.</p>
        <p className={styles.moved}>+0 · still standing here</p>
      </div>
    );
  }
  const t = TIERS[outcome];
  return (
    <div className={`px-panel ${styles.card}`} data-tier={outcome} role="status" aria-live="polite">
      <p className={styles.tier}>{t.label}</p>
      <p className={styles.answer}>“{answer.name}”</p>
      <p className={styles.moved}>
        +{t.points} · {t.points}m closer
      </p>
      <p className={styles.flavour}>{flavourFor(outcome, seed)}</p>
      <p className={styles.share}>{formatShare(answer.share)} of the crowd said this</p>
      {answer.note ? <p className={`mono ${styles.note}`}>{answer.note}</p> : null}
    </div>
  );
}
