import { useEffect, useState } from "react";
import { useDialogsStore } from "../../state/dialogs";
import { useProgressStore } from "../../state/progress";
import styles from "./ProgressBar.module.css";

/** Inline progress of the running fetch/pull/push, with Cancel; lives in the status bar. */
export function ProgressBar() {
  const active = useProgressStore((s) => s.active);
  const cancelling = useProgressStore((s) => s.cancelling);
  const cancel = useProgressStore((s) => s.cancel);
  const [now, setNow] = useState(() => Date.now());
  const running = active !== null;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.repeat) return;
      if (useDialogsStore.getState().current !== null) return;
      void useProgressStore.getState().cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running]);

  if (active === null) return null;
  const elapsed = Math.max(0, Math.floor((now - active.startedAt) / 1000));
  const pct = active.pct === null ? null : Math.min(100, Math.max(0, Math.round(active.pct)));

  return (
    <div className={styles["root"]}>
      <span className={styles["text"]} aria-live="polite">
        <span className={styles["title"]}>
          {cancelling ? `${active.title} (cancelling)` : active.title}
        </span>
        {active.phase !== "" && <span className={styles["phase"]}>{active.phase}</span>}
        {pct !== null && <span className={styles["phase"]}>{`${pct}%`}</span>}
      </span>
      <div
        className={styles["track"]}
        role="progressbar"
        aria-label={active.title}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(pct !== null ? { "aria-valuenow": pct } : {})}
      >
        <div
          className={pct === null ? styles["indeterminate"] : styles["fill"]}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      <span className={styles["msg"]} title={active.msg}>
        {active.msg}
      </span>
      <span className={styles["elapsed"]}>{`${elapsed}s`}</span>
      <button
        type="button"
        className={styles["button"]}
        disabled={cancelling}
        title="Cancel (Esc)"
        onClick={() => void cancel()}
      >
        Cancel
      </button>
    </div>
  );
}
