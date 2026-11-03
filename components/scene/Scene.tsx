"use client";

import { useEffect, useRef } from "react";
import { loreFor } from "@/lib/share/lore";
import styles from "./Scene.module.css";
import {
  crowdOpts,
  drawAnimatedFar,
  drawBackground,
  drawBeams,
  drawCrowd,
  drawFog,
  drawHaze,
  drawStage,
  drawStars,
  farCrowdOpts,
  makeView,
} from "./render";

export interface SceneProps {
  /** Metres from the barricade. Changes animate. */
  distance: number;
  /** Horizon height as a fraction of the viewport (0 top … 1 bottom). Changes animate. */
  horizon?: number;
  /** 0..1 — how many hands are up. */
  hype?: number;
  /** 0..1 darkening layer for text-heavy pages. */
  dim?: number;
}

const FRAME_MS = 1000 / 30;

function easeInOutCubic(u: number): number {
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

interface Tween {
  from: number;
  to: number;
  start: number;
  dur: number;
}

function tweenValue(tw: Tween, now: number): number {
  if (tw.dur <= 0) return tw.to;
  const u = Math.min(1, Math.max(0, (now - tw.start) / tw.dur));
  return tw.from + (tw.to - tw.from) * easeInOutCubic(u);
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Logical canvas size: ~180px wide on phones, ~4 CSS px per pixel on desktop, whole device pixels per pixel. */
function measure(cssW: number, cssH: number, dpr: number) {
  const target = cssW < 700 ? 180 : Math.min(420, Math.max(240, cssW / 4));
  const k = Math.max(1, Math.round((cssW * dpr) / target));
  const W = Math.max(60, Math.ceil((cssW * dpr) / k));
  const H = Math.max(80, Math.ceil((cssH * dpr) / k));
  return { W, H, k, cssW: (W * k) / dpr, cssH: (H * k) / dpr };
}

export default function Scene({ distance, horizon = 0.5, hype = 0, dim = 0 }: SceneProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({
    d: { from: distance, to: distance, start: 0, dur: 0 } as Tween,
    hz: { from: horizon, to: horizon, start: 0, dur: 0 } as Tween,
    hype: { from: hype, to: hype, start: 0, dur: 0 } as Tween,
    still: false,
    W: 0,
    H: 0,
    request: () => {},
  });

  // Retarget tweens when props change.
  useEffect(() => {
    const L = live.current;
    const now = performance.now();
    const cur = tweenValue(L.d, now);
    if (L.d.to !== distance) {
      const delta = Math.abs(distance - cur);
      L.d = { from: cur, to: distance, start: now, dur: L.still ? 0 : Math.min(2400, Math.max(900, 700 + delta * 9)) };
      L.request();
    }
  }, [distance]);

  useEffect(() => {
    const L = live.current;
    const now = performance.now();
    if (L.hz.to !== horizon) {
      L.hz = { from: tweenValue(L.hz, now), to: horizon, start: now, dur: L.still ? 0 : 1000 };
      L.request();
    }
  }, [horizon]);

  useEffect(() => {
    const L = live.current;
    const now = performance.now();
    if (L.hype.to !== hype) {
      L.hype = { from: tweenValue(L.hype, now), to: hype, start: now, dur: L.still ? 0 : 700 };
      L.request();
    }
  }, [hype]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const L = live.current;

    let bg: HTMLCanvasElement | null = null;
    let bgKey = "";
    let far: HTMLCanvasElement | null = null;
    let farKey = "";
    let raf = 0;
    let last = 0;
    let running = false;
    const t0 = performance.now();

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    L.still = mq.matches;

    const render = (now: number) => {
      const { W, H } = L;
      if (!W || !H) return;
      const t = L.still ? 0 : (now - t0) / 1000;
      const d = tweenValue(L.d, now);
      const hz = tweenValue(L.hz, now);
      const hy = tweenValue(L.hype, now);
      const v = makeView(W, H, hz);

      const bk = `${W}x${H}x${v.hy}`;
      if (bk !== bgKey || !bg) {
        bg = bg && bg.width === W && bg.height === H ? bg : makeCanvas(W, H);
        const bctx = bg.getContext("2d");
        if (bctx) drawBackground(bctx, v);
        bgKey = bk;
      }
      ctx.drawImage(bg, 0, 0);
      drawStars(ctx, v, t, L.still);
      drawHaze(ctx, v, d, t);
      drawBeams(ctx, v, d, t, L.still);
      drawStage(ctx, v, d, t, L.still);
      drawFog(ctx, v, d, t, L.still);

      const hq = Math.round(hy * 10) / 10;
      const fk = `${bk}x${d.toFixed(2)}x${hq}`;
      if (fk !== farKey || !far) {
        far = far && far.width === W && far.height === H ? far : makeCanvas(W, H);
        const fctx = far.getContext("2d");
        if (fctx) {
          fctx.clearRect(0, 0, W, H);
          drawCrowd(fctx, v, d, "far", farCrowdOpts(hq));
        }
        farKey = fk;
      }
      ctx.drawImage(far, 0, 0);
      const opts = crowdOpts(t, hy, L.still);
      drawAnimatedFar(ctx, v, d, opts);
      drawCrowd(ctx, v, d, "near", opts);
    };

    const loop = (now: number) => {
      raf = 0;
      if (!running) return;
      if (now - last >= FRAME_MS - 2) {
        last = now;
        render(now);
      }
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (L.still || document.hidden) {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        render(performance.now());
        return;
      }
      if (running) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };

    L.request = () => {
      if (L.still || document.hidden) render(performance.now());
      else start();
    };

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const m = measure(Math.max(1, rect.width), Math.max(1, rect.height), dpr);
      if (m.W !== L.W || m.H !== L.H) {
        L.W = m.W;
        L.H = m.H;
        canvas.width = m.W;
        canvas.height = m.H;
        ctx.imageSmoothingEnabled = false;
      }
      canvas.style.width = `${m.cssW}px`;
      canvas.style.height = `${m.cssH}px`;
      render(performance.now());
    };

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const onVis = () => {
      if (document.hidden) {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else start();
    };
    const onMotion = () => {
      L.still = mq.matches;
      if (L.still) {
        // Jump every tween to its end.
        L.d = { ...L.d, dur: 0 };
        L.hz = { ...L.hz, dur: 0 };
        L.hype = { ...L.hype, dur: 0 };
      }
      start();
    };
    document.addEventListener("visibilitychange", onVis);
    mq.addEventListener("change", onMotion);
    start();

    return () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      mq.removeEventListener("change", onMotion);
      L.request = () => {};
    };
  }, []);

  const shown = Math.round(distance);
  return (
    <div className={styles.scene} ref={wrapRef}>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      <div className={styles.scan} aria-hidden="true" />
      <div className={styles.vignette} aria-hidden="true" />
      {dim > 0 ? <div className={styles.dim} style={{ opacity: dim }} aria-hidden="true" /> : null}
      <p className="sr-only">
        A night-time festival field. You are {shown === 0 ? "on the barricade" : `${shown} metres from the stage`}: {loreFor(shown)}.
      </p>
    </div>
  );
}
