import { useRef, useState } from "react";
import type { RepoId } from "../../ipc/types";
import { useOpsStore } from "../../state/ops";
import { FormDialog } from "./FormDialog";
import { validateRefName } from "./validate";
import styles from "./Form.module.css";

export interface CreateBranchDialogProps {
  repoId: RepoId;
  /** Oid or ref name. */
  startPoint: string;
  startLabel: string;
  onClose: () => void;
}

export function CreateBranchDialog({
  repoId,
  startPoint,
  startLabel,
  onClose,
}: CreateBranchDialogProps) {
  const [name, setName] = useState("");
  const [checkout, setCheckout] = useState(true);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const createBranch = useOpsStore((s) => s.createBranch);
  const error = validateRefName(name);

  return (
    <FormDialog
      title="Create branch"
      submitLabel="Create"
      valid={error === null}
      initialFocusRef={inputRef}
      onClose={onClose}
      onSubmit={() => createBranch(repoId, name, startPoint, checkout)}
    >
      <div className={styles["hint"]}>
        Starting at <code>{startLabel}</code>
      </div>
      <label className={styles["field"]}>
        <span className={styles["label"]}>Branch name</span>
        <input
          ref={inputRef}
          className={styles["input"]}
          value={name}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setName(e.target.value);
            setTouched(true);
          }}
        />
      </label>
      {touched && error !== null && (
        <div className={styles["error"]} role="alert">
          {error}
        </div>
      )}
      <label className={styles["check"]}>
        <input type="checkbox" checked={checkout} onChange={(e) => setCheckout(e.target.checked)} />
        <span>Check out after creating</span>
      </label>
    </FormDialog>
  );
}
