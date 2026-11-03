"use client";

import { useEffect, useRef, useState, type Ref } from "react";
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

type FlagState = "idle" | "sending" | "sent" | "failed";

/** "should X have counted?" and what follows it. Exported for tests. */
export function Flag({
  text,
  flag,
  ack,
  onSend,
  buttonRef,
  sentRef,
}: {
  text: string;
  flag: FlagState;
  ack: "focus" | "announce" | null;
  onSend(): void;
  buttonRef?: Ref<HTMLButtonElement>;
  sentRef?: Ref<HTMLSpanElement>;
}) {
  const sent = (
    <span ref={sentRef} className={styles.flagSent} tabIndex={-1}>
      thanks. an editor will take a look at “{text}”.
    </span>
  );
  return (
    <p className={styles.flag}>
      {flag === "sent" ? (
        ack === "announce" ? null : sent
      ) : (
        // aria-disabled, not disabled: a focused button that turns disabled
        // drops focus. The send handler already ignores clicks while sending.
        <button ref={buttonRef} type="button" className={styles.flagBtn} onClick={onSend} aria-disabled={flag === "sending" || undefined}>
          should “{text}” have counted?
        </button>
      )}
      {/* In the DOM before anything changes, so what lands in it is announced. */}
      <span role="status">
        {flag === "sent" && ack === "announce" ? sent : null}
        {flag === "failed" ? <span className={styles.flagErr}> couldn&apos;t send. try again?</span> : null}
      </span>
    </p>
  );
}

function Row({ round, tries, flagged, onFlag }: { round: RevealRound; tries: string[]; flagged: boolean; onFlag: YourSetProps["onFlag"] }) {
  const [open, setOpen] = useState(false);
  const [flag, setFlag] = useState<FlagState>(flagged ? "sent" : "idle");
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

  const flagBtn = useRef<HTMLButtonElement>(null);
  const flagSent = useRef<HTMLSpanElement>(null);
  // How a confirmation from this row reaches assistive tech, never both ways:
  // "focus" when the button had focus (it unmounts, so focus moves to the
  // confirmation and is read there), "announce" otherwise (live region).
  // Rows already flagged on an earlier visit start as "sent" with neither, so
  // they don't steal focus or speak on load.
  const [ack, setAck] = useState<"focus" | "announce" | null>(null);

  const sendFlag = async () => {
    if (!lastTry || flag === "sending" || flag === "sent") return;
    setFlag("sending");
    const ok = await onFlag(round.index, lastTry);
    if (ok) setAck(document.activeElement === flagBtn.current ? "focus" : "announce");
    setFlag(ok ? "sent" : "failed");
  };

  useEffect(() => {
    if (ack === "focus") flagSent.current?.focus({ preventScroll: true });
  }, [ack]);

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
      {!yours && lastTry ? <Flag text={lastTry} flag={flag} ack={ack} onSend={sendFlag} buttonRef={flagBtn} sentRef={flagSent} /> : null}
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
