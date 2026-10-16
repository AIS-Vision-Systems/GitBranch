import { useEffect, useRef, type ReactNode } from "react";
import { Dialog } from "./Dialog";
import styles from "./ConfirmDialog.module.css";

export interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  command?: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  command,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const latest = useRef({ onConfirm, busy });
  useEffect(() => {
    latest.current = { onConfirm, busy };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Enter" || e.defaultPrevented) return;
      // Danger: only the focused confirm button itself (native activation) may confirm.
      if (danger) return;
      // Buttons handle Enter natively; avoid double activation.
      if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      if (!latest.current.busy) latest.current.onConfirm();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [danger]);

  return (
    <Dialog
      title={title}
      onClose={onCancel}
      width="sm"
      initialFocusRef={danger ? cancelRef : confirmRef}
      footer={
        <>
          <button ref={cancelRef} type="button" className={styles["cancel"]} onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`${styles["confirm"]} ${danger ? styles["danger"] : ""}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className={styles["message"]}>{message}</div>
      {command !== undefined && <pre className={styles["command"]}>{command}</pre>}
    </Dialog>
  );
}
