import { useUiStore } from "../../state/ui";
import styles from "./Toasts.module.css";

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const dismissToast = useUiStore((s) => s.dismissToast);

  return (
    <div className={styles["region"]} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`${styles["toast"]} ${styles[t.kind]}`}>
          <span className={styles["title"]}>{t.title}</span>
          <button
            type="button"
            className={styles["dismiss"]}
            aria-label={`Dismiss: ${t.title}`}
            onClick={() => dismissToast(t.id)}
          >
            ×
          </button>
          {t.action !== undefined && (
            <button
              type="button"
              className={styles["action"]}
              onClick={() => {
                dismissToast(t.id);
                t.action?.run();
              }}
            >
              {t.action.label}
            </button>
          )}
          {t.detail !== undefined && (
            <details className={styles["details"]}>
              <summary>Details</summary>
              <pre className={styles["detail"]}>{t.detail}</pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
