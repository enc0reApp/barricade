"use client";

import { useState } from "react";
import type { RevealPick, RevealRound } from "@/lib/api/contract";
import { formatPercentNumber, formatShare } from "@/lib/client/format";
import { TIER_IDS, TIERS, type TierId } from "@/lib/game/tiers";
import PixelIcon from "@/components/ui/PixelIcon";
import TierChip from "./TierChip";
import styles from "./YourSet.module.css";

export interface YourSetProps {
  rounds: RevealRound[];
  /** Rejected tries per round index (from local storage), oldest first. */
  tries: Record<number, string[]>;
  flagged: number[];
  onFlag(index: number, text: string): Promise<boolean>;
}

function groupPicks(picks: RevealPick[]): [TierId, RevealPick[]][] {
  const out: [TierId, RevealPick[]][] = [];
  for (const id of [...TIER_IDS].reverse()) {
    const list = picks.filter((p) => p.tier === id);
    if (list.length) out.push([id, list]);
  }
  return out;
}

function Row({ round, tries, flagged, onFlag }: { round: RevealRound; tries: string[]; flagged: boolean; onFlag: YourSetProps["onFlag"] }) {
  const [open, setOpen] = useState(false);
  const [flag, setFlag] = useState<"idle" | "sending" | "sent" | "failed">(flagged ? "sent" : "idle");
  const yours = round.yours;
  const lastTry = tries[tries.length - 1];
  const id = `set-row-${round.index}`;
  const said = yours
    ? yours.crowdPct !== null
      ? `≈${formatPercentNumber(yours.crowdPct)}% said this`
      : `${formatShare(yours.share)} said this`
    : tries.length
      ? `${tries.length} ${tries.length === 1 ? "try" : "tries"}, none on the list`
      : "the clock ran out";

  const sendFlag = async () => {
    if (!lastTry || flag === "sending" || flag === "sent") return;
    setFlag("sending");
    setFlag((await onFlag(round.index, lastTry)) ? "sent" : "failed");
  };

  return (
    <li className={styles.row} data-open={open || undefined} data-tier={yours?.tier ?? "miss"}>
      <button type="button" className={styles.head} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <span className={styles.num}>{String(round.index + 1).padStart(2, "0")}</span>
        <span className={styles.body}>
          <span className={styles.prompt}>{round.text}</span>
          <span className={styles.line}>
            {yours ? <span className={styles.answer}>“{yours.name}”</span> : null}
            <TierChip outcome={yours?.tier ?? "miss"} points size="sm" />
          </span>
          <span className={styles.said}>{said}</span>
        </span>
        <span className={styles.caret} aria-hidden="true">
          <PixelIcon name={open ? "up" : "down"} size={2} />
        </span>
      </button>
      <div id={id} className={styles.more} hidden={!open}>
        {yours?.note ? <p className={`mono ${styles.note}`}>{yours.note}</p> : null}
        <p className={styles.could}>YOU COULD HAVE SAID</p>
        <ul className={styles.picks}>
          {groupPicks(round.picks).map(([tier, list]) => (
            <li key={tier} className={styles.group}>
              <TierChip outcome={tier} size="sm" />
              <ul className={styles.names}>
                {list.map((p) => (
                  <li key={p.name}>
                    <span className={styles.pick}>{p.name}</span>
                    {p.note ? <span className={`mono ${styles.pickNote}`}>{p.note}</span> : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className={styles.total}>{round.total} answers counted on this prompt.</p>
      </div>
      {!yours && lastTry ? (
        <p className={styles.flag}>
          {flag === "sent" ? (
            <span>thanks. an editor will take a look at “{lastTry}”.</span>
          ) : (
            <button type="button" className={styles.flagBtn} onClick={sendFlag} disabled={flag === "sending"}>
              should “{lastTry}” have counted?
            </button>
          )}
          {flag === "failed" ? <span className={styles.flagErr}> couldn&apos;t send. try again?</span> : null}
        </p>
      ) : null}
    </li>
  );
}

export default function YourSet({ rounds, tries, flagged, onFlag }: YourSetProps) {
  return (
    <section className={styles.set} aria-labelledby="your-set">
      <h2 id="your-set" className={styles.title}>
        YOUR SET
      </h2>
      <ol className={styles.list}>
        {rounds.map((r) => (
          <Row key={r.index} round={r} tries={tries[r.index] ?? []} flagged={flagged.includes(r.index)} onFlag={onFlag} />
        ))}
      </ol>
      <p className={styles.legend}>
        {TIER_IDS.map((id) => (
          <span key={id}>
            {TIERS[id].label} {TIERS[id].points}
          </span>
        ))}
      </p>
    </section>
  );
}
