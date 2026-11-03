"use client";

import Link from "next/link";
import { forwardRef } from "react";
import { formatSetDate } from "@/lib/client/format";
import Countdown from "@/components/ui/Countdown";
import Logo from "@/components/ui/Logo";
import PixelIcon from "@/components/ui/PixelIcon";
import Footer from "@/components/ui/Footer";
import styles from "./Doors.module.css";

export interface DoorsProps {
  number: number;
  date: string;
  title?: string;
  rounds: number;
  seconds: number;
  streak: number;
  archive: boolean;
  /** A round was started and is resumable. */
  resume?: boolean;
  onStart(): void;
  onMidnight?(): void;
}

export function SecondaryNav({ archive = false }: { archive?: boolean }) {
  return (
    <nav className={styles.nav} aria-label="More">
      <Link className="px-btn px-btn--ghost" href="/how">
        HOW TO PLAY
      </Link>
      <Link className="px-btn px-btn--ghost" href="/archive">
        {archive ? "ALL SETS" : "ARCHIVE"} <PixelIcon name="archive" size={2} />
      </Link>
      <Link className="px-btn px-btn--ghost" href="/crowd">
        LAST NIGHT&apos;S CROWD
      </Link>
    </nav>
  );
}

const Doors = forwardRef<HTMLButtonElement, DoorsProps>(function Doors(
  { number, date, title, rounds, seconds, streak, archive, resume = false, onStart, onMidnight },
  ref,
) {
  return (
    <div className={styles.doors}>
      {archive ? (
        <p className={styles.banner}>
          <span>ARCHIVE · NOT SCORED</span>
        </p>
      ) : null}
      <div className={styles.top}>
        <p className={styles.presents}>FSTVL.XYZ PRESENTS</p>
        <Logo size="lg" />
        <p className={styles.daily}>{archive ? `SET #${number} · ${formatSetDate(date)}` : "THE DAILY PUSH"}</p>
        <p className={styles.tag}>
          <span>
            {rounds} prompts · {seconds} seconds each
          </span>
          <span>rarer answers get you closer</span>
        </p>
        {title ? <p className={styles.title}>{`/// ${title} ///`}</p> : null}
      </div>
      <div className={styles.window} aria-hidden="true" />
      <div className={styles.bottom}>
        <button ref={ref} type="button" className={`px-btn px-btn--big ${styles.cta}`} onClick={onStart}>
          <span className="tri" aria-hidden="true">▲</span>
          {resume ? "KEEP PUSHING" : "PUSH TO THE FRONT"}
          <span className="tri" aria-hidden="true">▲</span>
        </button>
        <div className={styles.meta}>
          <span>
            SET #{number} · {formatSetDate(date)}
          </span>
          {streak > 0 && !archive ? <span className={styles.streak}>STREAK {streak}</span> : null}
        </div>
        {archive ? (
          <p className={styles.close}>
            <Link href="/archive">
              <PixelIcon name="left" size={2} /> back to the archive
            </Link>
          </p>
        ) : (
          <p className={styles.close}>
            DOORS CLOSE IN <Countdown className={styles.count} onDone={onMidnight} />
          </p>
        )}
        <SecondaryNav archive={archive} />
        <Footer />
      </div>
    </div>
  );
});

export default Doors;
