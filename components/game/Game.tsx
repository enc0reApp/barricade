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
 * mid-reveal shows the reveal's end state; finished shows the ticket. A
 * finished game is never played again over its record.
 *
 * Proof of play: each round after the first is started with the previous
 * round's token (+ receipt), and /api/finish gets every round's token. After a
 * missed round the client waits for the server's clock before asking.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SetInfo } from "@/lib/api/contract";
import { finishSet, getSet, isMockActive, noSetMeta, sendAnswer, sendFlag, startRound as startRoundApi } from "@/lib/client/api";
import { isStaleActivation } from "@/lib/client/keys";
import { nextSetOpensAt, remainingMs } from "@/lib/client/timer";
import {
  finishWaitMs,
  getStore,
  liveStreak,
  prevProof,
  progressOf,
  pushTry,
  receiptsOf,
  resumePoint,
  roundWaitMs,
  settleExpired,
  summaryFinish,
  tokensOf,
  withFlag,
  type Store,
  type StoredGame,
  type StoredRound,
} from "@/lib/client/storage";
import { addDays, dateForNumber, localDateString } from "@/lib/game/day";
import { DEFAULT_SECONDS, ROUNDS_PER_SET, START_DISTANCE, TIERS, outcomePoints, type Outcome } from "@/lib/game/tiers";
import Scene from "@/components/scene/Scene";
import Ruler from "@/components/scene/Ruler";
import PixelIcon from "@/components/ui/PixelIcon";
import Countdown from "@/components/ui/Countdown";
import { ticketDate } from "@/lib/share/lore";
import CrowdSurfReveal from "./CrowdSurfReveal";
import Doors from "./Doors";
import Hud from "./Hud";
import InputDock, { Feedback } from "./InputDock";
import PromptCard from "./PromptCard";
import Results from "./Results";
import StatusScreen from "./StatusScreen";
import TierCard, { TIER_CARD_ID } from "./TierCard";
import { useMediaQuery, useReducedMotion, useScrollLock, useVisualViewport } from "./useViewport";
import styles from "./Game.module.css";

export type GameRoute = { kind: "today" } | { kind: "archive"; number: number };

type Phase =
  | { k: "boot" }
  | { k: "fail" }
  | { k: "closed"; reason: "no-set" | "future" | "prelaunch" }
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

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

/** /api/finish refusals that aren't the network get this many quiet retries (e.g. a clock a hair early). */
const FINISH_RETRIES = 2;
const FINISH_RETRY_MS = 1500;
/** One quiet retry for a round refused right after a miss (our clock a hair early). */
const ROUND_RETRY_MS = 1000;

/** The id a game's tokens and receipts are bound to (older games: the device's id). */
function playerFor(g: StoredGame, store: Store): string {
  return g.playerId ?? store.playerId();
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
  /** Before set #1: the date the first doors open (from the no-set reply). */
  const [opensOn, setOpensOn] = useState<string | null>(null);

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
  const finishingRef = useRef(false);
  const revealAtRef = useRef(0);
  /** Re-boots from storage (set once init exists). */
  const resyncRef = useRef<() => void>(() => {});

  const go = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  /**
   * Saves `g` and makes it the game on screen. Returns false when storage
   * already held a further-along copy (another tab): that copy is adopted, the
   * game re-boots from it, and the caller must stop.
   */
  const commit = useCallback((g: StoredGame): boolean => {
    const saved = storeRef.current ? storeRef.current.putGame(g) : g;
    gameRef.current = saved;
    setGame(saved);
    if (saved !== g && (saved.status !== g.status || progressOf(saved) > progressOf(g))) {
      resyncRef.current();
      return false;
    }
    return true;
  }, []);

  const getRound = (index: number): StoredRound | undefined => gameRef.current?.rounds.find((r) => r.index === index);

  /* ───────────── finishing ───────────── */

  const finish = useCallback(async () => {
    const g = gameRef.current;
    const store = storeRef.current;
    if (!g || !store || finishingRef.current) return;
    if (g.status === "finished") {
      go({ k: "ticket" });
      return;
    }
    finishingRef.current = true;
    try {
      go({ k: "finishing", failed: false });
      const req = { date: g.date, playerId: playerFor(g, store), receipts: receiptsOf(g), tokens: tokensOf(g) };
      // The server reveals only once every missed round is past its deadline + grace.
      await sleep(finishWaitMs(g, Date.now()));
      let res = await finishSet(req);
      for (let i = 0; i < FINISH_RETRIES && !res.ok && res.error !== "server"; i++) {
        await sleep(FINISH_RETRY_MS);
        res = await finishSet(req);
      }
      if (gameRef.current?.date !== g.date) return; // the page moved on meanwhile
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
    } finally {
      finishingRef.current = false;
    }
  }, [go, route.kind]);

  /* ───────────── boot ───────────── */

  const init = useCallback(async () => {
    go({ k: "boot" });
    setFeedback(null);
    const store = getStore(isMockActive());
    store.refresh();
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
        // No set tonight (e.g. the schedule ran out): the server still knows the archive's bounds.
        const meta = noSetMeta(base);
        if (meta) {
          epoch = meta.epoch;
          latest = meta.latestNumber;
        } else {
          epoch = epochFromStore(store);
        }
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
      const meta = res.error === "no-set" && route.kind !== "archive" ? noSetMeta(res) : null;
      if (meta && meta.epoch > date) {
        // Pre-launch: set #1 hasn't happened yet anywhere near this player's tonight.
        setOpensOn(meta.epoch);
        go({ k: "closed", reason: "prelaunch" });
        return;
      }
      if (res.error === "server") go({ k: "fail" });
      else go({ k: "closed", reason: res.error === "future" ? "future" : "no-set" });
      return;
    }
    setRef.current = res;
    setSet(res);

    let g = store.game(date);
    if (g) {
      const settled = settleExpired(g, Date.now());
      g = settled !== g ? store.putGame(settled) : g;
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
      case "summary":
        go({ k: "ticket" });
        break;
    }
  }, [go, route, router, finish]);

  useEffect(() => {
    resyncRef.current = () => void init();
    void init();
  }, [init]);

  // Another tab moved this date's game on (played a round, finished it): pick that up.
  useEffect(() => {
    const store = getStore(isMockActive());
    return store.subscribe(() => {
      const date = gameRef.current?.date ?? setRef.current?.date;
      if (!date) return;
      const stored = store.game(date);
      if (stored && progressOf(stored) > progressOf(gameRef.current)) void init();
    });
  }, [init]);

  /** Tonight's route only: once the local date has moved on, boot the night that is open now. */
  const rollover = useCallback(() => {
    if (route.kind !== "today" || !todayRef.current) return;
    if (localDateString() !== todayRef.current) void init();
  }, [init, route.kind]);

  // Belt and braces for the doors / closed screens: the midnight countdown fires
  // at midnight, but a stale mount, a time-zone change or a sleeping tab can miss it.
  useEffect(() => {
    if (route.kind !== "today" || (phase.k !== "doors" && phase.k !== "closed")) return;
    const id = window.setInterval(rollover, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") rollover();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [phase.k, rollover, route.kind]);

  /* ───────────── rounds ───────────── */

  const startRound = useCallback(
    async (index: number) => {
      const s = setRef.current;
      const store = storeRef.current;
      if (!s || !store) return;
      let g = gameRef.current;
      if (g?.status === "finished") {
        // Never replay a finished game over its record (e.g. an old, compacted one).
        go({ k: "ticket" });
        return;
      }
      if (!g) {
        g = {
          number: s.number,
          date: s.date,
          mode: route.kind === "archive" ? "archive" : s.mode,
          status: "playing",
          total: s.rounds,
          rounds: [],
          playerId: store.playerId(),
        };
        if (!commit(g)) return;
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
      if (existing) {
        // Its clock ran out unanswered: that's a miss. The server owns the clock — never restart a round.
        if (!commit(replaceRound(g, { ...existing, outcome: "miss", receipt: null }))) return;
        go({ k: "reveal", index, travel: false });
        return;
      }
      setFeedback(null);
      setInput("");
      go({ k: "starting", index, failed: false });
      const base = g;
      const req = { date: base.date, index, playerId: playerFor(base, store), ...prevProof(base, index) };
      // After a miss, the next round opens only once the missed round's answer window
      // (deadline + grace) has closed on the server. Retry once in case our clock was a hair early.
      await sleep(roundWaitMs(base, index, Date.now()));
      let res = await startRoundApi(req);
      if (!res.ok && res.error !== "server" && req.prevReceipt === null) {
        await sleep(ROUND_RETRY_MS);
        res = await startRoundApi(req);
      }
      const still = phaseRef.current.k === "starting" && phaseRef.current.index === index;
      if (!still || gameRef.current?.date !== base.date) return; // the page moved on meanwhile
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
      if (!commit(replaceRound(gameRef.current ?? base, round))) return;
      // Keys typed while the prompt loaded belong to no round.
      setInput("");
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
      if (!commit(replaceRound(g, { ...r, outcome: "miss", receipt: null }))) return;
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
      if (!commit(replaceRound(g, { ...cur, outcome: res.answer.tier, answer: res.answer, receipt: res.receipt }))) return;
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
    if (!commit(replaceRound(g, { ...cur, tries: pushTry(cur.tries, text) }))) return;
    const msg =
      res.reason === "offprompt" && res.canonical
        ? `${res.canonical.name.toUpperCase()} is real — just not an answer here.`
        : res.reason === "empty"
          ? "type something first"
          : `"${text}": not on tonight's list. try again`;
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
    // Capture phase, before the focused KEEP PUSHING button sees it: an Enter or
    // Space left over from typing at the buzzer (or a held key) must not advance.
    // Blocking the keydown stops the button's click for both keys.
    const guard = (e: KeyboardEvent) => {
      if (isStaleActivation(e, performance.now() - revealAtRef.current)) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "BUTTON" || t.tagName === "A" || t.tagName === "INPUT")) return;
      e.preventDefault();
      advance();
    };
    window.addEventListener("keydown", guard, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", guard, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [phase, advance]);

  /* ───────────── focus management ───────────── */

  useEffect(() => {
    if (phase.k === "round") inputRef.current?.focus({ preventScroll: true });
    else if (phase.k === "reveal" && !phase.travel) {
      revealAtRef.current = performance.now();
      keepRef.current?.focus({ preventScroll: true });
    } else if (phase.k === "ticket") resultsRef.current?.focus({ preventScroll: false });
  }, [phase]);

  /* ───────────── flags ───────────── */

  const onFlag = useCallback(
    async (index: number, text: string) => {
      const g = gameRef.current;
      const store = storeRef.current;
      if (!g || !store) return false;
      const res = await sendFlag({ date: g.date, index, text, playerId: playerFor(g, store) });
      if (!res.ok) return false;
      // Merge onto the newest copy of that date's game, not the one read before the request:
      // two flags in flight at once must both stick.
      const cur = gameRef.current;
      if (cur && cur.date === g.date) commit(withFlag(cur, index));
      else store.putGame(withFlag(store.game(g.date) ?? g, index)); // the page moved on: persist only
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
  // A compacted (old) finished game keeps only its summary: build its ticket from that.
  const finished = phase.k === "ticket" && game ? summaryFinish(game) : null;
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
  } else if (phase.k === "closed" && phase.reason === "prelaunch" && opensOn) {
    const [y, m, d] = opensOn.split("-").map(Number) as [number, number, number];
    content = (
      <StatusScreen
        kicker="SET #1"
        title="FIRST DOORS OPEN"
        body={
          <>
            <p>{ticketDate(opensOn)}. 7 prompts, 25 seconds each — rarer answers get you closer to the stage.</p>
            <p>
              doors in <Countdown target={new Date(y, m - 1, d).getTime()} onDone={() => void init()} />
            </p>
          </>
        }
        actions={
          <Link className="px-btn" href="/how">
            HOW TO PLAY
          </Link>
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
          onMidnight={route.kind === "today" ? rollover : undefined}
        />
      </>
    );
  } else if (phase.k === "ticket" && game && finished) {
    const tries: Record<number, string[]> = {};
    for (const r of game.rounds) tries[r.index] = r.tries;
    content = (
      <Results
        ref={resultsRef}
        finish={finished}
        title={set?.title}
        archive={archive || game.mode === "archive"}
        streak={streak}
        tries={tries}
        flagged={game.flagged ?? []}
        onFlag={onFlag}
        detail={game.finish !== undefined}
        nextOpen={nextSetOpensAt(game.date, set?.nextDate)}
        onMidnight={route.kind === "today" ? () => void init() : undefined}
      />
    );
  } else if (phase.k === "ticket" && game) {
    content = (
      <StatusScreen
        kicker={`SET #${game.number}`}
        title="ALREADY PLAYED."
        body={<p>you played this night. its details are no longer on this device.</p>}
        actions={
          <Link className="px-btn" href="/archive">
            THE ARCHIVE <PixelIcon name="archive" size={2} />
          </Link>
        }
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
          <button ref={keepRef} type="button" aria-describedby={TIER_CARD_ID} className="px-btn px-btn--big" data-long={phase.index >= lastIndex || undefined} onClick={advance}>
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
