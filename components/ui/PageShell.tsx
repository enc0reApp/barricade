import Link from "next/link";
import type { ReactNode } from "react";
import Scene from "@/components/scene/Scene";
import Footer from "./Footer";
import Logo from "./Logo";
import PixelIcon from "./PixelIcon";
import styles from "./PageShell.module.css";

/** Text pages (how, archive, crowd, 404): the field behind, dimmed, and a readable column. */
export default function PageShell({
  children,
  distance = 700,
  kicker,
  title,
  intro,
}: {
  children: ReactNode;
  distance?: number;
  kicker?: string;
  title: string;
  intro?: ReactNode;
}) {
  return (
    <>
      <Scene distance={distance} horizon={0.36} hype={0.3} dim={0.38} />
      <div className={styles.page}>
        <header className={styles.bar}>
          <Link href="/" className={styles.back}>
            <PixelIcon name="left" size={2} />
            <span>TONIGHT</span>
          </Link>
          <Link href="/" className={styles.logo} aria-label="BARRICADE home">
            <Logo size="sm" as="span" />
          </Link>
          <span className={styles.spacer} />
        </header>
        <main className={styles.main}>
          <div className={styles.head}>
            {kicker ? <p className={styles.kicker}>{kicker}</p> : null}
            <h1 className={styles.title}>{title}</h1>
            {intro ? <div className={styles.intro}>{intro}</div> : null}
          </div>
          {children}
        </main>
        <Footer />
      </div>
    </>
  );
}
