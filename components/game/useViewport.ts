"use client";

import { useEffect, useState } from "react";

/**
 * Tracks the visual viewport so the game frame (and the input dock at its
 * foot) stays above the iOS / Android on-screen keyboard. Writes --vv-h and
 * --vv-top on <html>; returns whether a keyboard looks open.
 */
export function useVisualViewport(active: boolean): boolean {
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const vv = window.visualViewport;
    const update = () => {
      const h = vv ? vv.height : window.innerHeight;
      const top = vv ? vv.offsetTop : 0;
      root.style.setProperty("--vv-h", `${Math.round(h)}px`);
      root.style.setProperty("--vv-top", `${Math.round(top)}px`);
      setKeyboard(window.innerHeight - h > 120);
    };
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      root.style.removeProperty("--vv-h");
      root.style.removeProperty("--vv-top");
    };
  }, [active]);
  return keyboard;
}

/** Locks document scrolling while the full-screen game frame is up. */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.classList.add("lock");
    return () => root.classList.remove("lock");
  }, [active]);
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia(query);
    } catch {
      return;
    }
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
