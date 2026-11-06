"use client";

import { useEffect, useRef, useState } from "react";
import { shareSiteUrl } from "@/lib/share/site-url";
import { encodeShareCode, shareText } from "@/lib/share/code";
import type { Outcome } from "@/lib/game/tiers";
import PixelIcon from "@/components/ui/PixelIcon";
import styles from "./ShareButtons.module.css";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://fstvl.xyz").replace(/\/$/, "");

async function copy(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function ShareButtons({ number, outcomes }: { number: number; outcomes: Outcome[] }) {
  const [base, setBase] = useState(SITE_URL);
  useEffect(() => setBase(shareSiteUrl(window.location.origin)), []);
  const [status, setStatus] = useState<null | "copied" | "shared" | "failed">(null);
  const timer = useRef(0);
  const text = shareText(number, outcomes, base);
  const url = `${base}/s/${encodeShareCode(number, outcomes)}`;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const flash = (s: "copied" | "shared" | "failed") => {
    setStatus(s);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus(null), 2200);
  };

  const share = async () => {
    // The URL travels separately so chat apps unfurl the ticket image.
    const body = text.split("\n").slice(0, -1).join("\n");
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ text: body, url });
        flash("shared");
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    flash((await copy(text)) ? "copied" : "failed");
  };

  const copyText = async () => flash((await copy(text)) ? "copied" : "failed");

  return (
    <div className={styles.share}>
      <button type="button" className={`px-btn px-btn--hot px-btn--big ${styles.primary}`} onClick={share}>
        {status === "copied" ? "COPIED" : status === "shared" ? "SHARED" : "SHARE TICKET"}
      </button>
      <details className={styles.more}>
        <summary>COPY OR VIEW SHARE TEXT</summary>
        <div className={styles.row}>
        <button type="button" className="px-btn px-btn--ghost" onClick={copyText}>
          <PixelIcon name={status === "copied" ? "check" : "copy"} size={2} />
          {status === "copied" ? "COPIED" : "COPY TEXT"}
        </button>
        <pre className={styles.preview} aria-label="Share text preview">
          {text}
        </pre>
        </div>
      </details>
      <p className={styles.status} role="status" aria-live="polite">
        {status === "copied" ? "copied to your clipboard" : status === "failed" ? "couldn't copy. open the share text above and copy it" : ""}
      </p>
    </div>
  );
}
