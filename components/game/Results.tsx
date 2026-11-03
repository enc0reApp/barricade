"use client";

import Link from "next/link";
import { Fragment, forwardRef } from "react";
import type { FinishResult } from "@/lib/api/contract";
import { formatCount, formatPercentNumber, formatSetDate } from "@/lib/client/format";
import { loreFor } from "@/lib/share/lore";
import Countdown from "@/components/ui/Countdown";
import Footer from "@/components/ui/Footer";
import Logo from "@/components/ui/Logo";
import PixelIcon from "@/components/ui/PixelIcon";
import { SecondaryNav } from "./Doors";
import ShareButtons from "./ShareButtons";
import Ticket from "./Ticket";
import YourSet from "./YourSet";
import styles from "./Results.module.css";

export interface ResultsProps {
  finish: FinishResult;
  title?: string;
  archive: boolean;
  streak: number;
  tries: Record<number, string[]>;
  flagged: number[];
  onFlag(index: number, text: string): Promise<boolean>;
  onMidnight?(): void;
}

const Results = forwardRef<HTMLHeadingElement, ResultsProps>(function Results(
  { finish, title, archive, streak, tries, flagged, onFlag, onMidnight },
  ref,
) {
  const { crowd } = finish;
  // "You beat 0% of the crowd" is a bad way to greet the first person through the gates.
  const beatPct = crowd.plays !== null && crowd.plays >= 2 ? crowd.beatPct : null;
  return (
    <div className={styles.results}>
      <header className={styles.head}>
        <Link href="/" className={styles.home} aria-label="BARRICADE home">
          <Logo size="md" as="span" />
        </Link>
        <p className={styles.sub}>
          SET #{finish.number} · {formatSetDate(finish.date)}
          {title ? ` · ${title}` : ""}
        </p>
      </header>

      <h1 className={styles.where} ref={ref} tabIndex={-1}>
        {finish.distance === 0 ? "you made it to the barricade." : `you ended up ${finish.distance}m from the stage.`}
        <span className={styles.lore}>{loreFor(finish.distance)}</span>
      </h1>

      <Ticket
        number={finish.number}
        date={finish.date}
        outcomes={finish.outcomes}
        distance={finish.distance}
        beatPct={beatPct}
        mode={finish.mode === "today" && !archive ? "today" : "archive"}
      />

      <ShareButtons number={finish.number} outcomes={finish.outcomes} />

      {crowd.plays !== null ? (
        <p className={styles.crowd}>
          {[
            beatPct !== null ? (
              <>
                you beat <b>{formatPercentNumber(beatPct)}%</b> of the crowd
              </>
            ) : crowd.plays !== null && crowd.plays < 2 ? (
              <>first one through the gates</>
            ) : null,
            <>{formatCount(crowd.plays)} played</>,
            streak > 0 && !archive ? (
              <>
                streak <b className={styles.streak}>{streak}</b>
              </>
            ) : null,
          ]
            .filter(Boolean)
            .map((chunk, i, all) => (
              <Fragment key={i}>
                <span className={styles.chunk}>
                  {chunk}
                  {i < all.length - 1 ? " ·" : ""}
                </span>{" "}
              </Fragment>
            ))}
        </p>
      ) : (
        <p className={styles.crowd}>archive play · no crowd numbers, no streak</p>
      )}

      {archive ? (
        <div className={styles.next}>
          <Link className="px-btn" href="/archive">
            <PixelIcon name="left" size={2} /> BACK TO THE ARCHIVE
          </Link>
          <Link className="px-btn px-btn--ghost" href="/">
            TONIGHT&apos;S SET
          </Link>
        </div>
      ) : (
        <p className={styles.doors}>
          DOORS OPEN IN <Countdown className={styles.count} onDone={onMidnight} />
        </p>
      )}

      <YourSet rounds={finish.rounds} tries={tries} flagged={flagged} onFlag={onFlag} />

      <SecondaryNav archive={archive} />
      <Footer />
    </div>
  );
});

export default Results;
