import styles from "./Logo.module.css";

/** A single solid pixel wordmark. */
export default function Logo({ size = "lg", as: Tag = "h1" }: { size?: "lg" | "md" | "sm"; as?: "h1" | "p" | "span" }) {
  return (
    <Tag className={`${styles.logo} ${styles[size]}`} data-text="BARRICADE" aria-label="BARRICADE">
      <span aria-hidden="true">BARRICADE</span>
    </Tag>
  );
}
