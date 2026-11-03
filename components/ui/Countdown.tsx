"use client";

import { useEffect, useRef, useState } from "react";
import { formatCountdown } from "@/lib/client/format";
import { msUntilLocalMidnight } from "@/lib/game/day";

/**
 * A live hh:mm:ss countdown. `target` is an epoch ms; without one it counts to
 * the player's next local midnight. Calls onDone once when it reaches zero.
 */
export default function Countdown({ target, onDone, className }: { target?: number; onDone?: () => void; className?: string }) {
  const remaining = () => (target !== undefined ? target - Date.now() : msUntilLocalMidnight());
  const [ms, setMs] = useState<number | null>(null);
  const done = useRef(false);
  const cb = useRef(onDone);
  cb.current = onDone;

  useEffect(() => {
    done.current = false;
    const tick = () => {
      const r = remaining();
      setMs(r);
      if (r <= 0 && !done.current) {
        done.current = true;
        cb.current?.();
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Render a stable placeholder on the server so hydration matches.
  return (
    <time className={className} suppressHydrationWarning>
      {ms === null ? "--:--:--" : formatCountdown(ms)}
    </time>
  );
}
