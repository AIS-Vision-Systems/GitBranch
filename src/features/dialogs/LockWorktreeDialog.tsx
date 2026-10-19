import { useRef, useState } from "react";
import type { RepoId } from "../../ipc/types";
import { useWorktreesStore } from "../../state/worktrees";
import { FormDialog } from "./FormDialog";
import styles from "./Form.module.css";

export interface LockWorktreeDialogProps {
  repoId: RepoId;
  path: string;
  onClose: () => void;
}

export function LockWorktreeDialog({ repoId, path, onClose }: LockWorktreeDialogProps) {
  const [reason, setReason] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <FormDialog
      title="Lock worktree"
      submitLabel="Lock"
      valid
      initialFocusRef={inputRef}
      onClose={onClose}
      onSubmit={() =>
        useWorktreesStore.getState().lock(repoId, path, reason.trim() === "" ? null : reason.trim())
      }
    >
      <div className={styles["hint"]}>
        <code>{path}</code>
      </div>
      <label className={styles["field"]}>
        <span className={styles["label"]}>Reason (optional)</span>
        <input
          ref={inputRef}
          className={styles["input"]}
          value={reason}
          autoComplete="off"
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
    </FormDialog>
  );
}
