import { openUrl } from "@tauri-apps/plugin-opener";
import { useUpdaterStore } from "../../state/updater";
import styles from "./UpdateCard.module.css";

export const RELEASES_URL = "https://github.com/AIS-Vision-Systems/GitBranch/releases/latest";

/** Non-blocking "update available" card. Never installs without a click. */
export function UpdateCard() {
  const status = useUpdaterStore((s) => s.status);
  const version = useUpdaterStore((s) => s.version);
  const progress = useUpdaterStore((s) => s.progress);
  const selfUpdate = useUpdaterStore((s) => s.selfUpdate);
  const dismissed = useUpdaterStore((s) => s.dismissed);
  const error = useUpdaterStore((s) => s.error);
  const install = useUpdaterStore((s) => s.install);
  const dismiss = useUpdaterStore((s) => s.dismiss);

  const busy = status === "downloading" || status === "ready";
  const check = useUpdaterStore((s) => s.check);
  const showError = status === "error" && !dismissed;
  const checkFailed = showError && version === null;
  if (!busy && !showError && !(status === "available" && !dismissed)) return null;

  if (checkFailed) {
    return (
      <div className={styles["card"]} role="status" aria-live="polite">
        <span role="alert">{`Update check failed: ${error ?? "unknown error"}`}</span>
        <div className={styles["actions"]}>
          <button type="button" onClick={dismiss}>
            Later
          </button>
          <button type="button" onClick={() => void check({ manual: true })}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles["card"]} role="status" aria-live="polite">
      <span>{`GitBranch ${version ?? ""} is available`}</span>
      {busy && (
        <>
          <progress className={styles["bar"]} max={100} value={progress} />
          <span>{status === "ready" ? "Restarting…" : `Downloading… ${progress}%`}</span>
        </>
      )}
      {showError && <span role="alert">{`Update failed: ${error ?? "unknown error"}`}</span>}
      {!busy && (
        <div className={styles["actions"]}>
          <button type="button" onClick={dismiss}>
            Later
          </button>
          {selfUpdate ? (
            <button type="button" onClick={() => void install()}>
              {showError ? "Retry" : "Update and restart"}
            </button>
          ) : (
            <button type="button" onClick={() => void openUrl(RELEASES_URL)}>
              Open release page
            </button>
          )}
        </div>
      )}
    </div>
  );
}
