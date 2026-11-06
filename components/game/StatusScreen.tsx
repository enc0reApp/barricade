import Link from "next/link";
import type { ReactNode } from "react";
import Footer from "@/components/ui/Footer";
import FieldPoster from "@/components/scene/FieldPoster";
import Logo from "@/components/ui/Logo";
import styles from "./StatusScreen.module.css";

/** A centred message over the field: loading, closed, errors. */
export default function StatusScreen({
  kicker,
  title,
  body,
  actions,
  busy = false,
}: {
  kicker?: string;
  title: string;
  body?: ReactNode;
  actions?: ReactNode;
  busy?: boolean;
}) {
  return (
    <div className={styles.screen} aria-busy={busy || undefined}>
      <Link href="/" className={styles.logo} aria-label="BARRICADE home">
        <Logo size="md" as="span" />
      </Link>
      <div className={styles.poster}><FieldPoster /><span>THE DAILY PUSH TO THE FRONT.</span></div>
      <div className={`px-panel ${styles.panel}`} role={busy ? "status" : undefined}>
        {kicker ? <p className={styles.kicker}>{kicker}</p> : null}
        <h1 className={styles.title} data-busy={busy || undefined}>
          {title}
        </h1>
        {body ? <div className={styles.body}>{body}</div> : null}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      <Footer />
    </div>
  );
}
