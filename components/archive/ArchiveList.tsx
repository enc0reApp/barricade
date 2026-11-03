"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getSet, isMockActive } from "@/lib/client/api";
import { formatSetDate } from "@/lib/client/format";
import { getStore, liveStreak, type StoredGame } from "@/lib/client/storage";
import { addDays, dateForNumber, localDateString } from "@/lib/game/day";
import { TierSquare } from "@/components/game/TierChip";
import PixelIcon from "@/components/ui/PixelIcon";
import styles from "./ArchiveList.module.css";

const PAGE = 14;

interface Row {
  number: number;
  date: string;
  title?: string;
  game: StoredGame | null;
  tonight: boolean;
}

type State =
  | { k: "loading" }
  | { k: "fail" }
  | { k: "empty" }
  | { k: "ok"; latest: number; epoch: string; today: string; todayNumber: number };

export default function ArchiveList() {
  const [state, setState] = useState<State>({ k: "loading" });
  const [games, setGames] = useState<Record<string, StoredGame>>({});
  const [titles, setTitles] = useState<Record<number, string | null>>({});
  const [shown, setShown] = useState(PAGE);
  const [stats, setStats] = useState({ played: 0, best: null as number | null, streak: 0, bestStreak: 0 });

  const load = useCallback(async () => {
    setState({ k: "loading" });
    const store = getStore(isMockActive());
    const all = store.read().games;
    setGames(all);
    const today = localDateString();
    const finished = Object.values(all).filter((g) => g.status === "finished");
    const dists = finished.map((g) => g.summary?.distance ?? g.finish?.distance).filter((d): d is number => typeof d === "number");
    const st = store.streak();
    setStats({ played: finished.length, best: dists.length ? Math.min(...dists) : null, streak: liveStreak(st, today), bestStreak: st.best });

    const res = await getSet(today);
    if (res.ok) {
      setTitles((t) => ({ ...t, [res.number]: res.title ?? null }));
      // latestNumber can be tomorrow somewhere (UTC+14); never list past the player's own night.
      setState({ k: "ok", latest: Math.min(res.latestNumber, res.number), epoch: res.epoch, today, todayNumber: res.number });
      return;
    }
    if (res.error === "server") {
      setState({ k: "fail" });
      return;
    }
    // No set tonight (end of the schedule): fall back to what we've played.
    const any = Object.values(all)[0];
    if (!any) {
      setState({ k: "empty" });
      return;
    }
    const epoch = addDays(any.date, 1 - any.number);
    const latest = Math.max(...Object.values(all).map((g) => g.number));
    setState({ k: "ok", latest, epoch, today, todayNumber: -1 });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Titles for the visible rows, a few requests at a time.
  useEffect(() => {
    if (state.k !== "ok") return;
    let cancelled = false;
    const wanted: number[] = [];
    for (let n = state.latest; n >= Math.max(1, state.latest - shown + 1); n--) if (!(n in titles)) wanted.push(n);
    const run = async () => {
      const queue = [...wanted];
      const worker = async () => {
        while (queue.length && !cancelled) {
          const n = queue.shift()!;
          const res = await getSet(dateForNumber(state.epoch, n));
          if (cancelled) return;
          setTitles((t) => ({ ...t, [n]: res.ok ? (res.title ?? null) : null }));
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, shown]);

  if (state.k === "loading") return <p className={styles.status}>flipping through the old wristbands…</p>;
  if (state.k === "fail")
    return (
      <div className={styles.status}>
        <p>the archive tent is closed for a sec. (we couldn&apos;t reach the server.)</p>
        <button type="button" className="px-btn" onClick={() => void load()}>
          TRY AGAIN
        </button>
      </div>
    );
  if (state.k === "empty") return <p className={styles.status}>no sets yet. the first doors haven&apos;t opened.</p>;

  const rows: Row[] = [];
  for (let n = state.latest; n >= Math.max(1, state.latest - shown + 1); n--) {
    const date = dateForNumber(state.epoch, n);
    const title = titles[n];
    rows.push({ number: n, date, ...(title ? { title } : {}), game: games[date] ?? null, tonight: n === state.todayNumber });
  }

  return (
    <>
      <dl className={styles.stats}>
        <div>
          <dt>PLAYED</dt>
          <dd>{stats.played}</dd>
        </div>
        <div>
          <dt>CLOSEST</dt>
          <dd>{stats.best === null ? "—" : stats.best === 0 ? "0m" : `${stats.best}m`}</dd>
        </div>
        <div>
          <dt>STREAK</dt>
          <dd>{stats.streak}</dd>
        </div>
        <div>
          <dt>BEST</dt>
          <dd>{stats.bestStreak}</dd>
        </div>
      </dl>
      <ol className={styles.list}>
        {rows.map((r) => {
          const done = r.game?.status === "finished";
          const outcomes = r.game?.summary?.outcomes ?? r.game?.finish?.outcomes ?? [];
          const dist = r.game?.summary?.distance ?? r.game?.finish?.distance;
          const href = r.tonight ? "/" : `/archive/${r.number}`;
          return (
            <li key={r.number}>
              <Link href={href} className={styles.row} data-done={done || undefined} data-tonight={r.tonight || undefined}>
                <span className={styles.num}>#{r.number}</span>
                <span className={styles.info}>
                  <span className={styles.date}>
                    {formatSetDate(r.date)}
                    {r.tonight ? <span className={styles.badge}>TONIGHT</span> : null}
                  </span>
                  <span className={styles.title}>{r.title ?? " "}</span>
                </span>
                <span className={styles.result}>
                  {done ? (
                    <>
                      <span className={styles.squares} aria-label={`${outcomes.length} rounds`}>
                        {outcomes.map((o, i) => (
                          <TierSquare key={i} outcome={o} />
                        ))}
                      </span>
                      <span className={styles.dist}>{dist === 0 ? "ON THE BARRICADE" : `${dist}m`}</span>
                    </>
                  ) : r.game ? (
                    <span className={styles.play}>RESUME</span>
                  ) : (
                    <span className={styles.play}>
                      PLAY <PixelIcon name="right" size={2} />
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      {state.latest - shown >= 1 ? (
        <button type="button" className="px-btn px-btn--ghost" onClick={() => setShown((s) => s + PAGE)}>
          SHOW OLDER SETS
        </button>
      ) : null}
    </>
  );
}
