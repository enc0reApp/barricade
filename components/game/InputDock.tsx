"use client";

import { forwardRef, type FormEvent } from "react";
import { displaySeconds, litSegments, vuLevel } from "@/lib/client/timer";
import styles from "./InputDock.module.css";

export interface InputDockProps {
  seconds: number;
  msLeft: number;
  value: string;
  onChange(v: string): void;
  onSubmit(): void;
  busy: boolean;
  /** Visually hidden but still mounted (so it can take focus inside a tap handler). */
  hidden: boolean;
  /** Increment to replay the reject shake. */
  shake: number;
  /** The clock isn't running yet (round loading). */
  idle?: boolean;
}

const InputDock = forwardRef<HTMLInputElement, InputDockProps>(function InputDock(
  { seconds, msLeft, value, onChange, onSubmit, busy, hidden, shake, idle = false },
  ref,
) {
  const secs = idle ? seconds : displaySeconds(msLeft);
  const lit = idle ? seconds : litSegments(seconds, msLeft);
  const level = vuLevel(secs);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <div className={styles.dock} data-hidden={hidden || undefined} aria-hidden={hidden || undefined}>
      <div className={styles.vu} data-level={level} role="timer" aria-label={`${secs} seconds left`}>
        <span className={styles.secs} aria-hidden="true">
          {String(secs).padStart(2, "0")}
        </span>
        <div className={styles.segments} aria-hidden="true">
          {Array.from({ length: seconds }, (_, i) => (
            <span key={i} className={styles.seg} data-on={i < lit || undefined} />
          ))}
        </div>
      </div>
      <form className={styles.row} onSubmit={submit}>
        <label htmlFor="answer" className="sr-only">
          Your answer
        </label>
        <div className={styles.field} data-shake={shake > 0 ? (shake % 2 ? "a" : "b") : undefined}>
          <input
            ref={ref}
            id="answer"
            name="answer"
            className={styles.input}
            type="text"
            inputMode="text"
            placeholder="Your answer…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={80}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              // Enter confirms an IME composition before it submits an answer.
              if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
            }}
            tabIndex={hidden ? -1 : 0}
            aria-describedby="prompt-text prompt-hint feedback"
          />
        </div>
        <button type="submit" aria-label={busy ? "Checking your answer" : "Submit your answer"} className={`px-btn px-btn--hot ${styles.push}`} disabled={busy || hidden} tabIndex={hidden ? -1 : 0}>
          {busy ? "…" : "GO"}
        </button>
      </form>
    </div>
  );
});

export default InputDock;

export function Feedback({ text, tone }: { text: string | null; tone: "warn" | "info" | "good" }) {
  return (
    <p id="feedback" className={styles.feedback} data-tone={tone} data-empty={!text || undefined} role="status" aria-live="polite">
      {text ?? " "}
    </p>
  );
}
