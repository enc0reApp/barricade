"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CrowdResponse } from "@/lib/api/contract";
import { getCrowd, isMockActive } from "@/lib/client/api";
import { formatCount, formatPercentNumber, formatSetDate } from "@/lib/client/format";
import { getStore } from "@/lib/client/storage";
import { addDays, localDateString } from "@/lib/game/day";
import { START_DISTANCE, TIERS } from "@/lib/game/tiers";
import Countdown from "@/components/ui/Countdown";
import PixelIcon from "@/components/ui/PixelIcon";
import TierChip from "@/components/game/TierChip";
import styles from "./CrowdView.module.css";

type View = { k: "loading" } | { k: "done"; res: CrowdResponse };

export default function CrowdView({ date }: { date: string }) {
  const [view, setView] = useState<View>({ k: "loading" });
  const [mine, setMine] = useState<number | null>(null);
  const [yesterday, setYesterday] = useState<string | null>(null);

  const load = useCallback(async () => {
    setView({ k: "loading" });
    const g = getStore(isMockActive()).game(date);
    const d = g?.summary?.distance ?? g?.finish?.distance;
    setMine(typeof d === "number" ? d : null);
    setYesterday(addDays(localDateString(), -1));
    setView({ k: "done", res: await getCrowd(date) });
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  const nav = (
    <nav className={styles.nav} aria-label="Other nights">
      <Link className="px-btn px-btn--ghost" href={`/crowd/${prev}`}>
        <PixelIcon name="left" size={2} /> {formatSetDate(prev)}
      </Link>
      {yesterday && next <= yesterday ? (
        <Link className="px-btn px-btn--ghost" href={`/crowd/${next}`}>
          {formatSetDate(next)} <PixelIcon name="right" size={2} />
        </Link>
      ) : null}
    </nav>
  );

  if (view.k === "loading") return <p className={styles.status}>counting wristbands…</p>;
  const res = view.res;

  if (!res.ok) {
    let body: React.ReactNode;
    if (res.error === "not-yet") {
      body = (
        <>
          <p className={styles.big}>the crowd&apos;s still in the field.</p>
          <p>
            opens in <Countdown target={res.opensAt} className={styles.count} onDone={() => void load()} />
          </p>
          <p className={styles.small}>the morning after opens once that night has ended everywhere on earth.</p>
        </>
      );
    } else if (res.error === "no-set") {
      body = <p className={styles.big}>no set that night.</p>;
    } else if (res.error === "future") {
      body = <p className={styles.big}>that night hasn&apos;t happened yet. no spoilers.</p>;
    } else {
      body = (
        <>
          <p className={styles.big}>couldn&apos;t reach the crowd.</p>
          <button type="button" className="px-btn" onClick={() => void load()}>
            TRY AGAIN
          </button>
        </>
      );
    }
    return (
      <>
        <div className={`px-panel ${styles.panel} ${styles.status}`}>{body}</div>
        {nav}
      </>
    );
  }

  const maxBucket = Math.max(1, ...res.distribution);
  const myBucket = mine === null ? -1 : Math.min(res.distribution.length - 1, Math.floor(mine / 50));

  return (
    <>
      <div className={styles.headline}>
        <p className={styles.setline}>
          SET #{res.number} · {formatSetDate(res.date)}
          {res.title ? ` · ${res.title}` : ""}
        </p>
        <dl className={styles.stats}>
          <div>
            <dt>PLAYED</dt>
            <dd>{formatCount(res.plays)}</dd>
          </div>
          <div>
            <dt>AVG DISTANCE</dt>
            <dd>{res.avgDistance === null ? "—" : `${Math.round(res.avgDistance)}m`}</dd>
          </div>
          {mine !== null ? (
            <div>
              <dt>YOU</dt>
              <dd className={styles.you}>{mine}m</dd>
            </div>
          ) : null}
        </dl>
      </div>

      <section className={`px-panel ${styles.panel}`} aria-labelledby="dist">
        <h2 id="dist" className={styles.h2}>
          WHERE EVERYONE ENDED UP
        </h2>
        <div className={styles.hist} role="img" aria-label={`Distribution of ${res.plays} finishing distances, from the stage to ${START_DISTANCE} metres back`}>
          {res.distribution.map((n, i) => (
            <div key={i} className={styles.col} data-you={i === myBucket || undefined}>
              <span className={styles.bar} style={{ height: `${Math.max(2, (n / maxBucket) * 100)}%` }} />
            </div>
          ))}
        </div>
        <div className={styles.axis} aria-hidden="true">
          <span>STAGE</span>
          <span>350m</span>
          <span>{START_DISTANCE}m</span>
        </div>
      </section>

      {res.rounds.map((r) => {
        const top = Math.max(1, ...r.top.map((t) => t.pct));
        return (
          <section key={r.index} className={`px-panel ${styles.panel}`} aria-labelledby={`r${r.index}`}>
            <p className={styles.rn}>PROMPT {r.index + 1}</p>
            <h2 id={`r${r.index}`} className={styles.prompt}>
              {r.text}
            </h2>
            <ol className={styles.top}>
              {[...r.top].sort((a, b) => b.pct - a.pct).map((t) => (
                <li key={t.name} className={styles.ans} data-tier={t.tier}>
                  <span className={styles.ansName}>{t.name}</span>
                  <span className={styles.ansBar}>
                    <span style={{ width: `${(t.pct / top) * 100}%` }} />
                  </span>
                  <span className={styles.ansPct}>{formatPercentNumber(t.pct)}%</span>
                  <span className="sr-only">{TIERS[t.tier].label}</span>
                </li>
              ))}
            </ol>
            <div className={styles.legend} aria-hidden="true">
              {[...new Set(r.top.map((t) => t.tier))].map((t) => (
                <TierChip key={t} outcome={t} size="sm" />
              ))}
            </div>
            <p className={styles.lone}>
              lone wolves: <b>{r.singles}</b> {r.singles === 1 ? "answer" : "answers"} only one person gave
              {r.singleNames.length ? <span className={styles.names}> · {r.singleNames.join(" · ")}</span> : null}
            </p>
            <p className={styles.miss}>{formatPercentNumber(r.missPct)}% missed it</p>
          </section>
        );
      })}
      {nav}
    </>
  );
}
