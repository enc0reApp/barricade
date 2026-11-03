"use client";

import { useEffect, useState } from "react";
import type { RoundPrompt } from "@/lib/api/contract";
import styles from "./PromptCard.module.css";

const TYPE_LABEL: Record<string, string> = {
  artist: "ARTISTS",
  city: "CITIES",
  country: "COUNTRIES",
  genre: "GENRES",
  festival: "FESTIVALS",
  venue: "VENUES",
  soundsystem: "SOUND SYSTEMS",
  label: "LABELS",
  gear: "GEAR",
  stage: "STAGES",
  other: "ANYTHING",
};

/** What a screen reader hears when a prompt arrives. "Prompt n of m" makes every round's text unique, so each one is a change. */
export function promptAnnouncement(prompt: RoundPrompt, index: number, total: number): string {
  const sentence = (s: string) => {
    const t = s.trim();
    return /[.?!…]$/.test(t) ? t : `${t}.`;
  };
  const hint = prompt.hint ? ` ${sentence(prompt.hint)}` : "";
  return `Prompt ${index + 1} of ${total}. ${sentence(prompt.text)}${hint} ${prompt.seconds} seconds.`;
}

export default function PromptCard({ prompt, loading = false, index, total }: { prompt: RoundPrompt | null; loading?: boolean; index: number; total: number }) {
  // Focus is already on the answer field when a prompt lands (it moves there
  // inside the tap), so nothing else reads the new prompt out. This live
  // region does. It must be in the accessibility tree before its text
  // arrives (text inserted together with a new region is often dropped), so
  // it stays empty for the first frame after mount.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const shown = prompt && !loading ? prompt : null;
  return (
    <section className={`px-panel ${styles.card}`} aria-labelledby="prompt-text" data-loading={loading || undefined}>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {armed && shown ? promptAnnouncement(shown, index, total) : ""}
      </p>
      <div className={styles.top}>
        <p className={styles.kicker}>
          PROMPT {index + 1} OF {total}
        </p>
        {prompt && prompt.types.length > 0 ? (
          <p className={styles.types}>{prompt.types.map((t) => TYPE_LABEL[t] ?? t.toUpperCase()).join(" · ")}</p>
        ) : null}
      </div>
      <h2 id="prompt-text" className={styles.text}>
        {shown ? shown.text : <span className={styles.wait}>the crowd shuffles forward…</span>}
      </h2>
      {shown?.hint ? (
        <p id="prompt-hint" className={`mono ${styles.hint}`}>
          {shown.hint}
        </p>
      ) : null}
      <p className={styles.foot} aria-hidden="true">
        <span className="tri">▲</span> rarer answers get you closer <span className="tri">▲</span>
      </p>
    </section>
  );
}
