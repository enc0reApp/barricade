"use client";

import Link from "next/link";
import { forwardRef } from "react";
import { formatSetDate } from "@/lib/client/format";
import Countdown from "@/components/ui/Countdown";
import Logo from "@/components/ui/Logo";
import PixelIcon from "@/components/ui/PixelIcon";
import Footer from "@/components/ui/Footer";
import FieldPoster from "@/components/scene/FieldPoster";
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
  sample?: boolean;
  nextOpen?: number | null;
  onStart(): void;
  onMidnight?(): void;
}

export function SecondaryNav({ archive = false }: { archive?: boolean }) {
  return (
    <nav className={styles.nav} aria-label="More">
      <Link href="/how">
        HOW TO PLAY
      </Link>
      <Link href="/archive">
        {archive ? "ALL SETS" : "ARCHIVE"}
      </Link>
      <Link href="/crowd">
        THE CROWD
      </Link>
    </nav>
  );
}

const Doors = forwardRef<HTMLButtonElement, DoorsProps>(function Doors(
  { number, date, title, rounds, seconds, streak, archive, sample = false, nextOpen, resume = false, onStart, onMidnight },
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
        {sample || title ? <p className={styles.presents}>{sample ? "DEMO SET" : title}</p> : null}
        <Logo size="lg" />
        <p className={styles.daily}>{archive ? `SET #${number} · ${formatSetDate(date)}` : "THE DAILY PUSH TO THE FRONT."}</p>
        <p className={styles.tag}>Rarer answers get you closer to the stage.</p>
      </div>
      <figure className={styles.window}>
        <FieldPoster />
        <figcaption><span>YOU START HERE</span><span>700m → 0m</span></figcaption>
      </figure>
      <div className={styles.bottom}>
        <p className={styles.rules}>{rounds} questions · {seconds} seconds each</p>
        <button ref={ref} type="button" className={`px-btn px-btn--big ${styles.cta}`} onClick={onStart}>
          {resume ? "RESUME SET" : archive ? "PLAY THIS SET" : "PLAY TODAY’S SET"}
          <span aria-hidden="true">→</span>
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
        ) : nextOpen === null ? (
          <p className={styles.close}>ONE-OFF SET · PLAY IT TODAY</p>
        ) : (
          <p className={styles.close}>
            NEW SET IN <Countdown className={styles.count} target={nextOpen} onDone={onMidnight} />
          </p>
        )}
        <SecondaryNav archive={archive} />
      </div>
      <Footer />
    </div>
  );
});

export default Doors;
