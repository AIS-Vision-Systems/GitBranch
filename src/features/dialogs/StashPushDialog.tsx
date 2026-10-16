import { useRef, useState } from "react";
import type { RepoId } from "../../ipc/types";
import { useOpsStore } from "../../state/ops";
import { FormDialog } from "./FormDialog";
import styles from "./Form.module.css";

export interface StashPushDialogProps {
  repoId: RepoId;
  onClose: () => void;
}

export function StashPushDialog({ repoId, onClose }: StashPushDialogProps) {
  const [message, setMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [keepIndex, setKeepIndex] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const stashPush = useOpsStore((s) => s.stashPush);

  return (
    <FormDialog
      title="Stash changes"
      submitLabel="Stash"
      valid
      initialFocusRef={inputRef}
      onClose={onClose}
      onSubmit={() =>
        stashPush(repoId, {
          message: message.trim() === "" ? null : message.trim(),
          includeUntracked,
          keepIndex,
          paths: [],
        })
      }
    >
      <label className={styles["field"]}>
        <span className={styles["label"]}>Message (optional)</span>
        <input
          ref={inputRef}
          className={styles["input"]}
          value={message}
          autoComplete="off"
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>
      <label className={styles["check"]}>
        <input
          type="checkbox"
          checked={includeUntracked}
          onChange={(e) => setIncludeUntracked(e.target.checked)}
        />
        <span>Include untracked files</span>
      </label>
      <label className={styles["check"]}>
        <input
          type="checkbox"
          checked={keepIndex}
          onChange={(e) => setKeepIndex(e.target.checked)}
        />
        <span>Keep index (leave staged changes in place)</span>
      </label>
    </FormDialog>
  );
}
