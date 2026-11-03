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

export default function PromptCard({ prompt, loading = false, index, total }: { prompt: RoundPrompt | null; loading?: boolean; index: number; total: number }) {
  return (
    <section className={`px-panel ${styles.card}`} aria-labelledby="prompt-text" data-loading={loading || undefined}>
      <div className={styles.top}>
        <p className={styles.kicker}>
          PROMPT {index + 1} OF {total}
        </p>
        {prompt && prompt.types.length > 0 ? (
          <p className={styles.types}>{prompt.types.map((t) => TYPE_LABEL[t] ?? t.toUpperCase()).join(" · ")}</p>
        ) : null}
      </div>
      <h2 id="prompt-text" className={styles.text}>
        {prompt && !loading ? prompt.text : <span className={styles.wait}>the crowd shuffles forward…</span>}
      </h2>
      {prompt?.hint && !loading ? <p className={`mono ${styles.hint}`}>{prompt.hint}</p> : null}
      <p className={styles.foot} aria-hidden="true">
        <span className="tri">▲</span> rarer answers get you closer <span className="tri">▲</span>
      </p>
    </section>
  );
}
