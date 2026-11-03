import type { AcceptedAnswer } from "@/lib/api/contract";
import { flavourFor } from "@/lib/client/flavour";
import { formatShare } from "@/lib/client/format";
import { TIERS, type Outcome } from "@/lib/game/tiers";
import styles from "./TierCard.module.css";

/**
 * The card's id. The button that takes focus when the card appears (KEEP
 * PUSHING) points its aria-describedby here, so focusing it reads the result.
 * The card itself is not a live region: it is inserted with its text already
 * in place, in the same commit that moves focus, so an announcement from it
 * would be unreliable and would compete with the focus.
 */
export const TIER_CARD_ID = "tier-card";

/** Words longer than this step the answer line down a size so they fit a 360px phone whole. */
const LONG_WORD = 14;

export function hasLongWord(name: string, max = LONG_WORD): boolean {
  return name.split(/\s+/).some((w) => w.length > max);
}

/** The end of the reveal: what tier it landed in, how far it carried you. */
export default function TierCard({ outcome, answer, seed }: { outcome: Outcome; answer: AcceptedAnswer | null; seed: string }) {
  if (outcome === "miss" || !answer) {
    return (
      <div id={TIER_CARD_ID} className={`px-panel ${styles.card}`} data-tier="miss">
        <p className={styles.tier}>TIME&apos;S UP.</p>
        <p className={styles.flavour}>the crowd didn&apos;t budge.</p>
        <p className={styles.moved}>+0 · still standing here</p>
      </div>
    );
  }
  const t = TIERS[outcome];
  return (
    <div id={TIER_CARD_ID} className={`px-panel ${styles.card}`} data-tier={outcome}>
      <p className={styles.tier}>{t.label}</p>
      <p className={styles.answer} data-long={hasLongWord(answer.name) || undefined}>
        “{answer.name}”
      </p>
      <p className={styles.moved}>
        +{t.points} · {t.points}m closer
      </p>
      <p className={styles.flavour}>{flavourFor(outcome, seed)}</p>
      <p className={styles.share}>{formatShare(answer.share)} of the crowd said this</p>
      {answer.note ? <p className={`mono ${styles.note}`}>{answer.note}</p> : null}
    </div>
  );
}
