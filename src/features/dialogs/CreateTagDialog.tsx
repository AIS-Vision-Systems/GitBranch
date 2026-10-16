import { useRef, useState } from "react";
import type { RepoId } from "../../ipc/types";
import { quotePath } from "../../lib/shellQuote";
import { confirm } from "../../state/dialogs";
import { useOpsStore } from "../../state/ops";
import { FormDialog } from "./FormDialog";
import { validateRefName } from "./validate";
import styles from "./Form.module.css";

export interface CreateTagDialogProps {
  repoId: RepoId;
  target: string;
  targetLabel: string;
  onClose: () => void;
}

export function CreateTagDialog({ repoId, target, targetLabel, onClose }: CreateTagDialogProps) {
  const [name, setName] = useState("");
  const [annotated, setAnnotated] = useState(false);
  const [message, setMessage] = useState("");
  const [force, setForce] = useState(false);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const createTag = useOpsStore((s) => s.createTag);
  const error = validateRefName(name);

  return (
    <FormDialog
      title="Create tag"
      submitLabel="Create"
      valid={error === null && (!annotated || message.trim() !== "")}
      initialFocusRef={inputRef}
      onClose={onClose}
      onSubmit={async () => {
        const args = { name, target, message: annotated ? message.trim() : null, force };
        if (force) {
          let ok = false;
          await confirm({
            title: "Replace tag",
            message: `Force-create tag ${name}? An existing tag with this name will be moved.`,
            command: `git tag -f ${quotePath(name)} ${quotePath(target)}`,
            confirmLabel: "Replace",
            danger: true,
            onConfirm: async () => {
              ok = await createTag(repoId, args);
            },
          });
          return ok;
        }
        return createTag(repoId, args);
      }}
    >
      <div className={styles["hint"]}>
        Tagging <code>{targetLabel}</code>
      </div>
      <label className={styles["field"]}>
        <span className={styles["label"]}>Tag name</span>
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
        <input
          type="checkbox"
          checked={annotated}
          onChange={(e) => setAnnotated(e.target.checked)}
        />
        <span>Annotated</span>
      </label>
      {annotated && (
        <label className={styles["field"]}>
          <span className={styles["label"]}>Message</span>
          <textarea
            className={styles["textarea"]}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
      )}
      <label className={styles["check"]}>
        <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
        <span>Force (replace an existing tag)</span>
      </label>
    </FormDialog>
  );
}
