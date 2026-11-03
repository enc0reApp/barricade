"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AcceptedAnswer } from "@/lib/api/contract";
import { plaqueText } from "@/lib/client/format";
import { buildRevealCurve, revealDuration, spreadLabels, targetFor, tierLines } from "@/lib/client/reveal";
import { TIERS, type Outcome } from "@/lib/game/tiers";
import styles from "./CrowdSurfReveal.module.css";

export interface CrowdSurfRevealProps {
  outcome: Outcome;
  answer: AcceptedAnswer | null;
  /** True while the plaque travels; false shows the end state. */
  playing: boolean;
  /** Travel finished or skipped. */
  onDone(): void;
  reduced: boolean;
}

const LINES = tierLines();
const SKINS = ["#e8b48f", "#9c6440", "#c98a5a", "#f3cfa3", "#6e4128"];

/** Pixel hands holding the plaque up. Arms bob out of phase so it looks passed along. */
function Hands({ seed }: { seed: number }) {
  return (
    <div className={styles.hands} aria-hidden="true">
      {[0, 1, 2, 3].map((i) => {
        const skin = SKINS[(seed + i * 3) % SKINS.length]!;
        return (
          <svg key={i} className={styles.hand} style={{ animationDelay: `${-i * 0.13}s` }} viewBox="0 0 9 26" width="18" height="52" shapeRendering="crispEdges">
            <rect x="1" y="0" width="1" height="3" fill={skin} />
            <rect x="3" y="0" width="1" height="2" fill={skin} />
            <rect x="5" y="0" width="1" height="2" fill={skin} />
            <rect x="7" y="1" width="1" height="3" fill={skin} />
            <rect x="1" y="2" width="7" height="4" fill={skin} />
            <rect x="2" y="6" width="5" height="2" fill={skin} />
            <rect x="2" y="8" width="5" height="18" fill="#0b0e22" />
            <rect x="2" y="8" width="1" height="18" fill="#2b2a5c" />
            <rect x="1" y="2" width="7" height="1" fill="#ffffff" opacity="0.25" />
          </svg>
        );
      })}
    </div>
  );
}

export default function CrowdSurfReveal({ outcome, answer, playing, onDone, reduced }: CrowdSurfRevealProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const plaqueRef = useRef<HTMLDivElement>(null);
  const [trackH, setTrackH] = useState(0);
  const [reached, setReached] = useState<number>(playing ? 0 : targetFor(outcome));
  const [landed, setLanded] = useState(!playing);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const skipRef = useRef<(() => void) | null>(null);
  const target = targetFor(outcome);
  const curve = useMemo(() => buildRevealCurve(target), [target]);

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setTrackH(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The travel itself: rAF drives the plaque's transform directly.
  useEffect(() => {
    if (!playing) {
      setReached(target);
      setLanded(true);
      return;
    }
    if (reduced || target === 0) {
      setReached(target);
      setLanded(true);
      doneRef.current();
      return;
    }
    setLanded(false);
    setReached(0);
    const dur = revealDuration(target);
    const start = performance.now();
    let raf = 0;
    let lastReached = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      setReached(target);
      setLanded(true);
      window.setTimeout(() => doneRef.current(), 380);
    };
    const step = (now: number) => {
      const u = (now - start) / dur;
      const pos = curve.at(u);
      const h = trackRef.current?.getBoundingClientRect().height ?? 0;
      if (plaqueRef.current) plaqueRef.current.style.transform = `translate(-50%, ${-Math.round((pos / 100) * h)}px)`;
      const passed = LINES.filter((l) => l.points <= pos + 0.01).length;
      if (passed !== lastReached) {
        lastReached = passed;
        setReached(LINES[passed - 1]?.points ?? 0);
      }
      if (u >= 1) finish();
      else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const skip = () => {
      if (plaqueRef.current) {
        const h = trackRef.current?.getBoundingClientRect().height ?? 0;
        plaqueRef.current.style.transform = `translate(-50%, ${-Math.round((target / 100) * h)}px)`;
      }
      finish();
    };
    skipRef.current = skip;
    return () => {
      finished = true;
      cancelAnimationFrame(raf);
      skipRef.current = null;
    };
  }, [playing, target, curve, reduced]);

  /** Pixel nudges that keep the MAIN STAGE / TOTE BAG labels from overlapping. */
  const labelNudge = useMemo(() => {
    if (!trackH) return LINES.map(() => 0);
    const px = LINES.map((l) => (l.points / 100) * trackH);
    const spread = spreadLabels(px, 15);
    return spread.map((p, i) => p - px[i]!);
  }, [trackH]);

  const tierClass = outcome === "miss" ? "miss" : outcome;
  const seed = (answer?.name.length ?? 3) + (answer?.points ?? 0);

  return (
    <div
      className={styles.reveal}
      data-playing={playing || undefined}
      onPointerDown={playing ? () => skipRef.current?.() : undefined}
      onKeyDown={playing ? (e) => (e.key === "Enter" || e.key === " ") && skipRef.current?.() : undefined}
      role={playing ? "button" : undefined}
      tabIndex={playing ? 0 : undefined}
      aria-label={playing ? "Skip the reveal" : undefined}
    >
      <div className={styles.track} ref={trackRef}>
        {LINES.map((l, i) => (
          <div
            key={l.id}
            className={styles.line}
            data-tier={l.id}
            data-passed={reached >= l.points || undefined}
            data-final={landed && outcome === l.id ? true : undefined}
            style={{ bottom: `${l.points}%` }}
          >
            <span className={styles.lineLabel} style={{ bottom: `${4 + labelNudge[i]!}px` }}>
              {TIERS[l.id].label} · {l.points}
            </span>
          </div>
        ))}
        {outcome !== "miss" && answer ? (
          <div
            ref={plaqueRef}
            className={styles.carry}
            data-landed={landed || undefined}
            style={{ transform: `translate(-50%, ${playing ? 0 : -Math.round((target / 100) * trackH)}px)` }}
            aria-hidden="true"
          >
            <div className={`${styles.plaque} ${styles[tierClass] ?? ""}`}>
              “<span className={styles.plaqueName}>{plaqueText(answer.name, 22)}</span>”
            </div>
            <Hands seed={seed} />
          </div>
        ) : null}
      </div>
      {playing ? <p className={styles.skip}>tap to skip</p> : null}
    </div>
  );
}
