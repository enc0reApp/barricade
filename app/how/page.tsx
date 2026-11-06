import type { Metadata } from "next";
import Link from "next/link";
import TierChip from "@/components/game/TierChip";
import PageShell from "@/components/ui/PageShell";
import { DEFAULT_SECONDS, ROUNDS_PER_SET, START_DISTANCE, TIER_IDS, TIERS } from "@/lib/game/tiers";
import styles from "./how.module.css";

export const metadata: Metadata = {
  title: "How to play",
  description: "Seven prompts, 25 seconds each. The rarer your answer, the closer the crowd carries you to the stage.",
};

const EXAMPLES = ["artists", "festivals", "venues", "tour cities", "countries", "genres", "sound-system crews", "stages"];

export default function HowPage() {
  return (
    <PageShell
      kicker="THE RULES"
      title="HOW TO PLAY"
      intro={
        <p>
          You&apos;re at the back of the field, {START_DISTANCE}m from the stage. Every answer is a crowd you push through. The rarer the
          answer, the further the crowd carries you.
        </p>
      }
    >
      <section className={`px-panel ${styles.panel}`} aria-labelledby="rules">
        <h2 id="rules" className={styles.h2}>
          THE PUSH
        </h2>
        <ol className={styles.steps}>
          <li>
            <span className={styles.n}>01</span>
            <span>
              Each scheduled night: <b>{ROUNDS_PER_SET} prompts</b>, <b>{DEFAULT_SECONDS} seconds</b> each. Everyone plays the same set on
              their own local date.
            </span>
          </li>
          <li>
            <span className={styles.n}>02</span>
            <span>
              Type <b>one answer</b> per prompt. Your first accepted answer locks in. Answers can be {EXAMPLES.join(", ")}. Whatever the prompt asks for.
            </span>
          </li>
          <li>
            <span className={styles.n}>03</span>
            <span>
              Not on the list? Try again. No penalty, just the clock. Common typos, accents and a missing &ldquo;the&rdquo; are forgiven.
            </span>
          </li>
          <li>
            <span className={styles.n}>04</span>
            <span>
              Each answer carries you forward by its tier&apos;s points, in metres. Seven perfect answers put you{" "}
              <b className={styles.hot}>ON THE BARRICADE</b>.
            </span>
          </li>
          <li>
            <span className={styles.n}>05</span>
            <span>
              Play tonight&apos;s set on consecutive nights to build a <b>streak</b>. Archive sets are for practice: not scored, never
              counted.
            </span>
          </li>
        </ol>
      </section>

      <section className={`px-panel ${styles.panel}`} aria-labelledby="tiers">
        <h2 id="tiers" className={styles.h2}>
          THE TIERS
        </h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">TIER</th>
              <th scope="col" className={styles.pts}>
                METRES
              </th>
            </tr>
          </thead>
          <tbody>
            {TIER_IDS.map((id) => (
              <tr key={id}>
                <td>
                  <TierChip outcome={id} />
                  <span className={styles.blurb}>{TIERS[id].blurb}</span>
                </td>
                <td className={styles.pts}>{TIERS[id].points}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.note}>
          <b>TOTE BAG</b> is the &ldquo;obscure&rdquo; pick that everyone who wants to look clever says. It still moves you, just not
          as far as a real deep cut.
        </p>
      </section>

      <section className={`px-panel ${styles.panel}`} aria-labelledby="rarity">
        <h2 id="rarity" className={styles.h2}>
          HOW RARITY WORKS
        </h2>
        <ol className={styles.flow}>
          <li>
            <b>Fame.</b> Every answer starts with a year of Wikipedia pageviews: a rough read of how many people know it.
          </li>
          <li>
            <b>Editors.</b> Fame lies sometimes. Paris is famous, but almost nobody says Paris for &ldquo;a city with a Lollapalooza&rdquo;.
            An editor makes those calls before the set goes live.
          </li>
          <li>
            <b>The crowd.</b> Tiers are frozen for the night so everyone is scored the same. Then the real numbers come back on your
            ticket and in <Link href="/crowd">the Morning After</Link>, and feed the next rebuild.
          </li>
        </ol>
      </section>

      <Link className="px-btn px-btn--big" href="/">
        <span className="tri" aria-hidden="true">
          ▲
        </span>
        PUSH TO THE FRONT
        <span className="tri" aria-hidden="true">
          ▲
        </span>
      </Link>
    </PageShell>
  );
}
