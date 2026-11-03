import styles from "./Footer.module.css";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <p>
        a <a href="https://fstvl.xyz">fstvl.xyz</a> game · made by <a href="https://www.enc0re.com">enc0re</a>
      </p>
      <p className={styles.small}>No account. Answers are stored anonymously to work out rarity.</p>
    </footer>
  );
}
