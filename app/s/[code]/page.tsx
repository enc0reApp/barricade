import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ShareTicket } from "@/components/share/ShareTicket";
import { decodeShareCode, encodeShareCode } from "@/lib/share/code";
import { loreFor, shareHeadline } from "@/lib/share/lore";
import { shareSetInfo } from "@/lib/share/set-date";
import { starfieldShadow } from "@/lib/share/starfield";
import styles from "./page.module.css";

interface Props {
  params: Promise<{ code: string }>;
}

const STARS = starfieldShadow({ seed: 1709, count: 140, width: 1600, height: 1100 });

function titleFor(number: number, distance: number): string {
  return `BARRICADE #${number} — ${distance === 0 ? "on the barricade" : `${distance}m from the stage`}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const s = decodeShareCode(code);
  if (!s) return { title: "Ticket not found", robots: { index: false } };
  const canonical = encodeShareCode(s.number, s.outcomes);
  const title = titleFor(s.number, s.distance);
  const description =
    s.distance === 0
      ? `Someone made it to the barricade on set #${s.number}. 7 prompts about live music — the rarer your answer, the closer you get. Can you get closer?`
      : `Someone got ${s.distance}m from the stage on set #${s.number}. 7 prompts about live music — the rarer your answer, the closer you get. Can you get closer?`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/s/${canonical}` },
    // Share links are endless permutations of one page; keep them out of the index.
    robots: { index: false, follow: true },
    openGraph: {
      type: "website",
      siteName: "BARRICADE",
      title,
      description,
      url: `/s/${canonical}`,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SharePage({ params }: Props) {
  const { code } = await params;
  const s = decodeShareCode(code);
  if (!s) notFound();
  const canonical = encodeShareCode(s.number, s.outcomes);
  if (code !== canonical) permanentRedirect(`/s/${canonical}`);

  const { date, playable } = await shareSetInfo(s.number);

  return (
    <main className={styles.page}>
      <div className={styles.sky} aria-hidden="true">
        <div className={styles.stars} style={{ boxShadow: STARS }} />
      </div>

      <div className={styles.column}>
        <p className={styles.kicker}>
          <span className={styles.slashes}>///</span> A TICKET FROM THE FIELD <span className={styles.slashes}>///</span>
        </p>
        <h1 className={styles.headline}>{shareHeadline(s.distance)}</h1>
        <p className={styles.lore}>
          <span className={styles.loreMark} aria-hidden="true">
            ▲
          </span>{" "}
          {s.distance === 0 ? "hands on the rail." : `${loreFor(s.distance)}.`}
        </p>

        <div className={styles.ticket}>
          <ShareTicket number={s.number} outcomes={s.outcomes} date={date} />
        </div>

        <p className={styles.sub}>Can you get closer?</p>

        <div className={styles.actions}>
          <Link href="/" className={styles.cta}>
            <span className={styles.ctaEdge}>
              <span className={styles.ctaFace}>▲ PUSH TO THE FRONT ▲</span>
            </span>
          </Link>
          {playable ? (
            <Link href={`/archive/${s.number}`} className={styles.secondary}>
              play set #{s.number}
            </Link>
          ) : null}
        </div>

        <footer className={styles.footer}>
          <span>a fstvl.xyz game · made by enc0re</span>
        </footer>
      </div>
    </main>
  );
}
