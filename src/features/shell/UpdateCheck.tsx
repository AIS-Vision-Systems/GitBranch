import { useUpdaterStore } from "../../state/updater";
import styles from "./UpdateCheck.module.css";

/** "Check for updates" button with its checking / up-to-date / available / error hint. */
export function UpdateCheck() {
  const upd = useUpdaterStore();
  return (
    <div className={styles["row"]}>
      <button
        type="button"
        disabled={upd.status === "checking" || upd.status === "downloading"}
        onClick={() => void upd.check({ manual: true })}
      >
        Check for updates
      </button>
      {upd.status === "checking" && <span className={styles["hint"]}>Checking…</span>}
      {upd.status !== "checking" && upd.upToDate && (
        <span className={styles["hint"]}>You&apos;re up to date</span>
      )}
      {upd.status === "available" && (
        <span className={styles["hint"]}>{`GitBranch ${upd.version ?? ""} is available`}</span>
      )}
      {upd.status === "error" && upd.error !== null && (
        <span className={styles["hint"]} role="alert">{`Update check failed: ${upd.error}`}</span>
      )}
    </div>
  );
}
