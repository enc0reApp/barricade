"use client";

/**
 * The game state machine:
 *
 *   boot → doors → starting(i) → round(i) → reveal(i, travel) → reveal(i, card)
 *        → starting(i+1) … → finishing → ticket
 *
 * Side branches: closed (no set / not yet), fail (server down → retry).
 * Every transition that matters is persisted (lib/client/storage) so a reload
 * resumes: mid-round keeps the token until its deadline, then counts a miss;
 * mid-reveal shows the reveal's end state; finished shows the ticket.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SetInfo } from "@/lib/api/contract";
import { finishSet, getSet, isMockActive, sendAnswer, sendFlag, startRound as startRoundApi } from "@/lib/client/api";
import { remainingMs } from "@/lib/client/timer";
import {
  getStore,
  liveStreak,
  pushTry,
  receiptsOf,
  resumePoint,
  settleExpired,
  type Store,
  type StoredGame,
  type StoredRound,
} from "@/lib/client/storage";
import { addDays, dateForNumber, localDateString } from "@/lib/game/day";
import { DEFAULT_SECONDS, ROUNDS_PER_SET, START_DISTANCE, TIERS, outcomePoints, type Outcome } from "@/lib/game/tiers";
import Scene from "@/components/scene/Scene";
import Ruler from "@/components/scene/Ruler";
import PixelIcon from "@/components/ui/PixelIcon";
import CrowdSurfReveal from "./CrowdSurfReveal";
import Doors from "./Doors";
import Hud from "./Hud";
import InputDock, { Feedback } from "./InputDock";
import PromptCard from "./PromptCard";
import Results from "./Results";
import StatusScreen from "./StatusScreen";
import TierCard from "./TierCard";
import { useMediaQuery, useReducedMotion, useScrollLock, useVisualViewport } from "./useViewport";
import styles from "./Game.module.css";

export type GameRoute = { kind: "today" } | { kind: "archive"; number: number };

type Phase =
  | { k: "boot" }
  | { k: "fail" }
  | { k: "closed"; reason: "no-set" | "future" }
  | { k: "doors" }
  | { k: "starting"; index: number; failed: boolean }
  | { k: "round"; index: number }
  | { k: "reveal"; index: number; travel: boolean }
  | { k: "finishing"; failed: boolean }
  | { k: "ticket" };

type Tone = "warn" | "info" | "good";

function replaceRound(g: StoredGame, r: StoredRound): StoredGame {
  const rounds = g.rounds.filter((x) => x.index !== r.index);
  rounds.push(r);
  rounds.sort((a, b) => a.index - b.index);
  return { ...g, rounds };
}

/** Puzzle #1's date, worked out from any game we've stored (date − (number − 1) days). */
function epochFromStore(store: Store): string | null {
  const g = Object.values(store.read().games)[0];
  return g ? addDays(g.date, 1 - g.number) : null;
}

export default function Game({ route: routeProp }: { route: GameRoute }) {
  const router = useRouter();
  const routeKind = routeProp.kind;
  const routeNumber = routeProp.kind === "archive" ? routeProp.number : 0;
  const route: GameRoute = useMemo(
    () => (routeKind === "archive" ? { kind: "archive", number: routeNumber } : { kind: "today" }),
    [routeKind, routeNumber],
  );
  const reduced = useReducedMotion();
  const wide = useMediaQuery("(min-width: 900px)");
  const [phase, setPhaseState] = useState<Phase>({ k: "boot" });
  const [set, setSet] = useState<SetInfo | null>(null);
  const [game, setGame] = useState<StoredGame | null>(null);
  const [streak, setStreak] = useState(0);
  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; tone: Tone } | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const [now, setNow] = useState(0);
  const [closedDate, setClosedDate] = useState<string | null>(null);

  const storeRef = useRef<Store | null>(null);
  const gameRef = useRef<StoredGame | null>(null);
  const setRef = useRef<SetInfo | null>(null);
  const phaseRef = useRef<Phase>(phase);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const todayRef = useRef("");
  const inputValue = useRef("");
  inputValue.current = input;

  const go = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const commit = useCallback((g: StoredGame) => {
    gameRef.current = g;
    storeRef.current?.putGame(g);
    setGame(g);
  }, []);

  const getRound = (index: number): StoredRound | undefined => gameRef.current?.rounds.find((r) => r.index === index);

  /* ───────────── finishing ───────────── */

  const finish = useCallback(async () => {
    const g = gameRef.current;
    const store = storeRef.current;
    if (!g || !store) return;
    go({ k: "finishing", failed: false });
    const res = await finishSet({ date: g.date, playerId: store.playerId(), receipts: receiptsOf(g) });
    if (!res.ok) {
      go({ k: "finishing", failed: true });
      return;
    }
    const forStore: StoredGame = route.kind === "archive" ? { ...g, mode: "archive" } : g;
    const { game: done, streak: st } = store.finishGame(forStore, res);
    gameRef.current = done;
    setGame(done);
    setStreak(liveStreak(st, todayRef.current));
    go({ k: "ticket" });
  }, [go, route.kind]);

  /* ───────────── boot ───────────── */

  const init = useCallback(async () => {
    go({ k: "boot" });
    setFeedback(null);
    const store = getStore(isMockActive());
    storeRef.current = store;
    const today = localDateString();
    todayRef.current = today;
    setStreak(liveStreak(store.streak(), today));

    let date = today;
    if (route.kind === "archive") {
      const base = await getSet(today);
      let epoch: string | null = null;
      let latest: number | null = null;
      if (base.ok) {
        epoch = base.epoch;
        latest = base.latestNumber;
      } else if (base.error === "server") {
        go({ k: "fail" });
        return;
      } else {
        epoch = epochFromStore(store);
      }
      if (!epoch) {
        go({ k: "closed", reason: "no-set" });
        return;
      }
      date = dateForNumber(epoch, route.number);
      setClosedDate(date);
      if (date === today) {
        router.replace("/");
        return;
      }
      if ((latest !== null && route.number > latest) || date > today) {
        go({ k: "closed", reason: "future" });
        return;
      }
    }

    const res = await getSet(date);
    if (!res.ok) {
      setClosedDate(date);
      if (res.error === "server") go({ k: "fail" });
      else go({ k: "closed", reason: res.error === "future" ? "future" : "no-set" });
      return;
    }
    setRef.current = res;
    setSet(res);

    let g = store.game(date);
    if (g) {
      const settled = settleExpired(g, Date.now());
      if (settled !== g) store.putGame(settled);
      g = settled;
    }
    gameRef.current = g;
    setGame(g);
    const rp = resumePoint(g);
    switch (rp.kind) {
      case "doors":
        go({ k: "doors" });
        break;
      case "round":
        go({ k: "round", index: rp.index });
        break;
      case "reveal":
        go({ k: "reveal", index: rp.index, travel: false });
        break;
      case "finishing":
        void finish();
        break;
      case "ticket":
        go({ k: "ticket" });
        break;
    }
  }, [go, route, router, finish]);

  useEffect(() => {
    void init();
  }, [init]);

  /* ───────────── rounds ───────────── */

  const startRound = useCallback(
    async (index: number) => {
      const s = setRef.current;
      const store = storeRef.current;
      if (!s || !store) return;
      let g = gameRef.current;
      if (!g) {
        g = {
          number: s.number,
          date: s.date,
          mode: route.kind === "archive" ? "archive" : s.mode,
          status: "playing",
          total: s.rounds,
          rounds: [],
        };
        commit(g);
      }
      const existing = g.rounds.find((r) => r.index === index);
      if (existing && existing.outcome !== undefined) {
        go({ k: "reveal", index, travel: false });
        return;
      }
      if (existing && remainingMs(existing.deadline, existing.offset, Date.now()) > 0) {
        go({ k: "round", index });
        return;
      }
      setFeedback(null);
      setInput("");
      go({ k: "starting", index, failed: false });
      const res = await startRoundApi({ date: g.date, index, playerId: store.playerId() });
      if (!res.ok) {
        go({ k: "starting", index, failed: true });
        return;
      }
      const round: StoredRound = {
        index,
        token: res.token,
        deadline: res.deadline,
        prompt: res.prompt,
        offset: res.serverNow - Date.now(),
        tries: [],
      };
      commit(replaceRound(gameRef.current ?? g, round));
      setNow(Date.now());
      go({ k: "round", index });
    },
    [commit, go, route.kind],
  );

  const timeUp = useCallback(
    (index: number) => {
      const g = gameRef.current;
      const r = getRound(index);
      if (!g || !r || r.outcome !== undefined) return;
      commit(replaceRound(g, { ...r, outcome: "miss", receipt: null }));
      inputRef.current?.blur();
      setFeedback({ text: "time's up", tone: "warn" });
      go({ k: "reveal", index, travel: false });
    },
    [commit, go],
  );

  const submit = useCallback(async () => {
    const ph = phaseRef.current;
    if (ph.k !== "round" || busyRef.current) return;
    const r = getRound(ph.index);
    if (!r || r.outcome !== undefined) return;
    const text = inputValue.current.trim();
    if (!text) {
      setFeedback({ text: "type something first", tone: "warn" });
      setShake((n) => n + 1);
      return;
    }
    if (r.tries.some((t) => t.toLowerCase() === text.toLowerCase())) {
      setFeedback({ text: `already tried "${text}". try another`, tone: "warn" });
      setShake((n) => n + 1);
      inputRef.current?.select();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    const res = await sendAnswer({ token: r.token, text });
    busyRef.current = false;
    setBusy(false);
    const cur = getRound(ph.index);
    const stillHere = phaseRef.current.k === "round" && phaseRef.current.index === ph.index;
    if (!cur || cur.outcome !== undefined || !stillHere) return;
    const g = gameRef.current!;

    if (!res.ok) {
      setFeedback({ text: res.error === "bad-token" ? "your wristband didn't scan. try again" : "the signal dropped. try again", tone: "warn" });
      setShake((n) => n + 1);
      setNow(Date.now());
      return;
    }
    if (res.status === "accepted") {
      commit(replaceRound(g, { ...cur, outcome: res.answer.tier, answer: res.answer, receipt: res.receipt }));
      setInput("");
      setFeedback(null);
      inputRef.current?.blur();
      go({ k: "reveal", index: ph.index, travel: !reduced });
      return;
    }
    if (res.status === "expired") {
      timeUp(ph.index);
      return;
    }
    commit(replaceRound(g, { ...cur, tries: pushTry(cur.tries, text) }));
    const msg =
      res.reason === "offprompt" && res.canonical
        ? `${res.canonical.name.toUpperCase()} is real — just not an answer here.`
        : res.reason === "empty"
          ? "type something first"
          : `"${text}": never heard of 'em. try again`;
    setFeedback({ text: msg, tone: "warn" });
    setShake((n) => n + 1);
    inputRef.current?.select();
    setNow(Date.now());
  }, [commit, go, reduced, timeUp]);

  // The round clock.
  useEffect(() => {
    if (phase.k !== "round") return;
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase.k !== "round") return;
    const r = getRound(phase.index);
    if (!r || r.outcome !== undefined) return;
    if (now && remainingMs(r.deadline, r.offset, now) <= 0 && !busyRef.current) timeUp(phase.index);
  }, [now, phase, timeUp, game]);

  /* ───────────── reveal → next ───────────── */

  const travelDone = useCallback(() => {
    const ph = phaseRef.current;
    if (ph.k === "reveal" && ph.travel) go({ k: "reveal", index: ph.index, travel: false });
  }, [go]);

  const advance = useCallback(() => {
    const ph = phaseRef.current;
    const g = gameRef.current;
    if (ph.k !== "reveal" || ph.travel || !g) return;
    if (ph.index + 1 < g.total) {
      // Focus inside the tap so mobile keyboards open for the next prompt.
      inputRef.current?.focus({ preventScroll: true });
      void startRound(ph.index + 1);
    } else {
      void finish();
    }
  }, [finish, startRound]);

  useEffect(() => {
    if (phase.k !== "reveal" || phase.travel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "BUTTON" || t.tagName === "A" || t.tagName === "INPUT")) return;
      e.preventDefault();
      advance();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, advance]);

  /* ───────────── focus management ───────────── */

  useEffect(() => {
    if (phase.k === "round") inputRef.current?.focus({ preventScroll: true });
    else if (phase.k === "reveal" && !phase.travel) keepRef.current?.focus({ preventScroll: true });
    else if (phase.k === "ticket") resultsRef.current?.focus({ preventScroll: false });
  }, [phase]);

  /* ───────────── flags ───────────── */

  const onFlag = useCallback(
    async (index: number, text: string) => {
      const g = gameRef.current;
      const store = storeRef.current;
      if (!g || !store) return false;
      const res = await sendFlag({ date: g.date, index, text, playerId: store.playerId() });
      if (!res.ok) return false;
      commit({ ...g, flagged: [...new Set([...(g.flagged ?? []), index])] });
      return true;
    },
    [commit],
  );

  /* ───────────── derived view ───────────── */

  const total = set?.rounds ?? game?.total ?? ROUNDS_PER_SET;
  const travelling = phase.k === "reveal" && phase.travel ? phase.index : -1;
  const shown: (Outcome | null)[] = useMemo(
    () =>
      Array.from({ length: total }, (_, i) => {
        const r = game?.rounds.find((x) => x.index === i);
        if (!r || r.outcome === undefined || i === travelling) return null;
        return r.outcome;
      }),
    [game, total, travelling],
  );
  const points = shown.reduce((sum, o) => sum + (o ? outcomePoints(o) : 0), 0);
  const finished = phase.k === "ticket" && game?.finish ? game.finish : null;
  const distance = finished ? finished.distance : Math.max(0, START_DISTANCE - points);

  const inFrame = phase.k === "starting" || phase.k === "round" || phase.k === "reveal" || phase.k === "finishing";
  const keyboard = useVisualViewport(inFrame);
  useScrollLock(inFrame);

  const currentIndex = phase.k === "starting" || phase.k === "round" || phase.k === "reveal" ? phase.index : null;
  const currentRound = currentIndex !== null ? game?.rounds.find((r) => r.index === currentIndex) : undefined;
  const seconds = currentRound?.prompt.seconds ?? set?.seconds[currentIndex ?? 0] ?? DEFAULT_SECONDS;
  const msLeft = currentRound && phase.k === "round" && now ? remainingMs(currentRound.deadline, currentRound.offset, now) : seconds * 1000;

  let horizon = 0.5;
  let hype = 0.2;
  if (phase.k === "doors") {
    hype = 0.25;
    horizon = wide ? 0.6 : 0.5;
  }
  if (inFrame) horizon = wide ? 0.3 : 0.17;
  if (phase.k === "round" || phase.k === "starting") hype = 0.15;
  if (phase.k === "reveal") {
    const o = currentRound?.outcome;
    hype = phase.travel ? 0.95 : o && o !== "miss" ? 0.25 + TIERS[o].points / 140 : 0.05;
  }
  if (phase.k === "ticket") {
    horizon = 0.3;
    hype = 0.3 + ((START_DISTANCE - distance) / START_DISTANCE) * 0.6;
  }

  const archive = route.kind === "archive";
  const scene = <Scene distance={distance} horizon={horizon} hype={hype} dim={phase.k === "ticket" ? 0.3 : 0} />;

  /* ───────────── screens ───────────── */

  let content: React.ReactNode = null;
  if (phase.k === "boot") {
    content = <StatusScreen title="DOORS OPENING…" busy body={<p>finding your spot in the field</p>} />;
  } else if (phase.k === "fail") {
    content = (
      <StatusScreen
        kicker="TECHNICAL DIFFICULTIES"
        title="THE PA JUST BLEW."
        body={<p>we couldn&apos;t reach the stage. check your signal and try again.</p>}
        actions={
          <button type="button" className="px-btn" onClick={() => void init()}>
            TRY AGAIN
          </button>
        }
      />
    );
  } else if (phase.k === "closed") {
    content = (
      <StatusScreen
        kicker={archive ? `SET #${route.number}` : undefined}
        title={phase.reason === "future" ? "NOT YET." : archive ? "NO SET THAT NIGHT." : "DOORS ARE CLOSED TONIGHT"}
        body={
          phase.reason === "future" ? (
            <p>that night hasn&apos;t happened yet. no spoilers.</p>
          ) : (
            <p>nothing&apos;s on the bill{closedDate && !archive ? " tonight" : ""}. the archive is open all night.</p>
          )
        }
        actions={
          <>
            <Link className="px-btn" href="/archive">
              THE ARCHIVE <PixelIcon name="archive" size={2} />
            </Link>
            <Link className="px-btn px-btn--ghost" href="/how">
              HOW TO PLAY
            </Link>
          </>
        }
      />
    );
  } else if (phase.k === "doors" && set) {
    content = (
      <>
        <div className={styles.rulerDesk}>
          <Ruler distance={distance} lore="all" />
        </div>
        <Doors
          number={set.number}
          date={set.date}
          title={set.title}
          rounds={set.rounds}
          seconds={set.seconds[0] ?? DEFAULT_SECONDS}
          streak={streak}
          archive={archive}
          resume={(game?.rounds.length ?? 0) > 0}
          onStart={() => {
            // Focus inside the tap so mobile keyboards open for the first prompt.
            inputRef.current?.focus({ preventScroll: true });
            void startRound(game?.rounds.length ?? 0);
          }}
          onMidnight={route.kind === "today" ? () => void init() : undefined}
        />
      </>
    );
  } else if (phase.k === "ticket" && game?.finish) {
    const tries: Record<number, string[]> = {};
    for (const r of game.rounds) tries[r.index] = r.tries;
    content = (
      <Results
        ref={resultsRef}
        finish={game.finish}
        title={set?.title}
        archive={archive || game.mode === "archive"}
        streak={streak}
        tries={tries}
        flagged={game.flagged ?? []}
        onFlag={onFlag}
        onMidnight={route.kind === "today" ? () => void init() : undefined}
      />
    );
  }

  // The frame (starting / round / reveal / finishing) is also mounted, invisibly,
  // behind the doors so its input can take focus inside the first tap.
  const showFrame = inFrame || (phase.k === "doors" && set !== null);
  const revealRound = phase.k === "reveal" ? currentRound : undefined;
  const lastIndex = total - 1;
  const frame = showFrame ? (
    <div className={styles.frame} data-phase={phase.k} data-kb={keyboard || undefined} data-archive={archive || undefined} data-off={!inFrame || undefined} aria-hidden={!inFrame || undefined}>
      {archive ? <p className={styles.archiveTag}>ARCHIVE · NOT SCORED</p> : null}
      <Hud distance={distance} points={points} outcomes={shown} current={currentIndex} total={total} />
      {inFrame ? <Ruler distance={distance} lore={phase.k === "reveal" ? "all" : "none"} /> : null}

      {phase.k === "starting" || phase.k === "round" ? (
        <div className={styles.cardSlot}>
          <PromptCard
            key={currentIndex ?? -1}
            prompt={currentRound?.prompt ?? null}
            loading={phase.k === "starting"}
            index={currentIndex ?? 0}
            total={total}
          />
          {phase.k === "starting" && phase.failed ? (
            <div className={styles.retry}>
              <p>the crowd won&apos;t budge. (we couldn&apos;t reach the stage.)</p>
              <button type="button" className="px-btn" onClick={() => void startRound(phase.index)}>
                TRY AGAIN
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {phase.k === "reveal" && revealRound?.outcome !== undefined ? (
        <div className={styles.revealSlot}>
          <CrowdSurfReveal
            key={`r${phase.index}`}
            outcome={revealRound.outcome}
            answer={revealRound.answer ?? null}
            playing={phase.travel}
            onDone={travelDone}
            reduced={reduced}
          />
          {!phase.travel ? (
            <div className={styles.cardCenter}>
              <TierCard outcome={revealRound.outcome} answer={revealRound.answer ?? null} seed={`${revealRound.prompt.text}:${phase.index}`} />
            </div>
          ) : null}
        </div>
      ) : null}

      {phase.k === "finishing" ? (
        <div className={styles.cardCenter}>
          {phase.failed ? (
            <div className={styles.retry}>
              <p>couldn&apos;t print your ticket. your answers are safe.</p>
              <button type="button" className="px-btn" onClick={() => void finish()}>
                TRY AGAIN
              </button>
            </div>
          ) : (
            <p className={styles.printing} role="status">
              printing your ticket…
            </p>
          )}
        </div>
      ) : null}

      <div className={styles.spacer} />

      {phase.k === "reveal" && !phase.travel ? (
        <div className={styles.keep}>
          <button ref={keepRef} type="button" className="px-btn px-btn--big" data-long={phase.index >= lastIndex || undefined} onClick={advance}>
            <span className="tri" aria-hidden="true">▲</span>
            {phase.index >= lastIndex ? "SEE WHERE YOU ENDED UP" : "KEEP PUSHING"}
            <span className="tri" aria-hidden="true">▲</span>
          </button>
        </div>
      ) : null}

      {phase.k === "round" || phase.k === "starting" ? <Feedback text={feedback?.text ?? null} tone={feedback?.tone ?? "info"} /> : null}
      <InputDock
        ref={inputRef}
        seconds={seconds}
        msLeft={msLeft}
        value={input}
        onChange={setInput}
        onSubmit={() => void submit()}
        busy={busy || phase.k !== "round"}
        hidden={phase.k !== "round" && phase.k !== "starting"}
        shake={shake}
        idle={phase.k !== "round"}
      />
    </div>
  ) : null;

  return (
    <>
      {scene}
      {content}
      {frame}
    </>
  );
}
