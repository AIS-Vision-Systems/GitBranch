import { useRef, useState } from "react";
import type { RepoId } from "../../ipc/types";
import { useOpsStore } from "../../state/ops";
import { FormDialog } from "./FormDialog";
import { validateRefName } from "./validate";
import styles from "./Form.module.css";

export interface RenameBranchDialogProps {
  repoId: RepoId;
  name: string;
  onClose: () => void;
}

export function RenameBranchDialog({ repoId, name, onClose }: RenameBranchDialogProps) {
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameBranch = useOpsStore((s) => s.renameBranch);
  const error = validateRefName(value);

  return (
    <FormDialog
      title={`Rename branch ${name}`}
      submitLabel="Rename"
      valid={error === null && value !== name}
      initialFocusRef={inputRef}
      onClose={onClose}
      onSubmit={() => renameBranch(repoId, name, value)}
    >
      <label className={styles["field"]}>
        <span className={styles["label"]}>New name</span>
        <input
          ref={inputRef}
          className={styles["input"]}
          value={value}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      {value !== name && error !== null && (
        <div className={styles["error"]} role="alert">
          {error}
        </div>
      )}
    </FormDialog>
  );
}
