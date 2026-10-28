import { ProgressBar } from "./ProgressBar";
import styles from "./StatusBar.module.css";

/** Bottom bar: the running network operation on the left, the app version on the right. */
export function StatusBar({ version }: { version: string | null }) {
  return (
    <footer className={styles["root"]}>
      <div className={styles["left"]}>
        <ProgressBar />
      </div>
      {version !== null && <span className={styles["version"]}>{`v${version}`}</span>}
    </footer>
  );
}
