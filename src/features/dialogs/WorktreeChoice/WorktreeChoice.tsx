import { useEffect, useRef } from "react";
import { useReposStore } from "../../../state/repos";
import styles from "./WorktreeChoice.module.css";

export function WorktreeChoice() {
  const pending = useReposStore((s) => s.pendingWorktree);
  const resolveWorktree = useReposStore((s) => s.resolveWorktree);
  const cancelWorktree = useReposStore((s) => s.cancelWorktree);
  const dialogRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLButtonElement>(null);
  const isOpen = pending !== null;

  useEffect(() => {
    if (!isOpen) return;
    mainRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelWorktree();
      } else if (e.key === "Tab" && dialogRef.current) {
        const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button"));
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, cancelWorktree]);

  if (pending === null) return null;

  return (
    <div className={styles["backdrop"]}>
      <div
        ref={dialogRef}
        className={styles["dialog"]}
        role="dialog"
        aria-modal="true"
        aria-labelledby="worktree-choice-title"
      >
        <h2 id="worktree-choice-title" className={styles["title"]}>
          This folder is a worktree of {pending.mainWorkTree}.
        </h2>
        <div className={styles["actions"]}>
          <button
            ref={mainRef}
            type="button"
            className={styles["primary"]}
            onClick={() => void resolveWorktree("main")}
          >
            Open main repository
          </button>
          <button
            type="button"
            className={styles["secondary"]}
            onClick={() => void resolveWorktree("worktree")}
          >
            Open this worktree
          </button>
        </div>
      </div>
    </div>
  );
}
