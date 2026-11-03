"use client";

import { useEffect, useRef, useState } from "react";
import { formatCountdown } from "@/lib/client/format";
import { countdownEnd } from "@/lib/client/timer";

/**
 * A live hh:mm:ss countdown. `target` is an epoch ms; without one it counts to
 * the player's next local midnight as of when it mounted. Calls onDone once
 * when it reaches zero (also on the first tick after a sleeping tab wakes).
 */
export default function Countdown({ target, onDone, className }: { target?: number; onDone?: () => void; className?: string }) {
  const [ms, setMs] = useState<number | null>(null);
  const done = useRef(false);
  const cb = useRef(onDone);
  cb.current = onDone;

  useEffect(() => {
    done.current = false;
    // A fixed instant: "next midnight" re-measured on every tick would never reach zero.
    const end = countdownEnd(target, Date.now());
    const tick = () => {
      const r = end - Date.now();
      setMs(r);
      if (r <= 0 && !done.current) {
        done.current = true;
        cb.current?.();
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    // Background tabs throttle intervals; catch up as soon as the tab is shown.
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [target]);

  // Render a stable placeholder on the server so hydration matches.
  return (
    <time className={className} suppressHydrationWarning>
      {ms === null ? "--:--:--" : formatCountdown(ms)}
    </time>
  );
}
