import { useRef, useState } from "react";
import type { RepoId } from "../../ipc/types";
import { useOpsStore } from "../../state/ops";
import { remotesOf, useRemotesStore } from "../../state/remotes";
import { FormDialog } from "./FormDialog";
import { validateRemoteName } from "./validate";
import styles from "./Form.module.css";

const HIDDEN = "***@";
const HIDDEN_MSG = "This URL hides credentials; type it in full";

export interface EditRemoteDialogProps {
  repoId: RepoId;
  name: string;
  onClose: () => void;
}

export function EditRemoteDialog({ repoId, name, onClose }: EditRemoteDialogProps) {
  const remotes = useRemotesStore((s) => remotesOf(s, repoId));
  // Snapshot at mount; advanced after each successful step so a retry only does the rest.
  const [b, setB] = useState(() => {
    const remote = remotes.find((r) => r.name === name);
    const pull = remote?.fetchUrl ?? "";
    return { name, pull, push: remote?.pushUrl ?? pull };
  });
  const [newName, setNewName] = useState(name);
  const [pullUrl, setPullUrl] = useState(b.pull);
  const [pushUrl, setPushUrl] = useState(b.push);
  const nameRef = useRef<HTMLInputElement>(null);
  const renameRemote = useOpsStore((s) => s.renameRemote);
  const setRemoteUrl = useOpsStore((s) => s.setRemoteUrl);
  const taken = remotes.some((r) => r.name === newName && r.name !== b.name);

  const nameError =
    validateRemoteName(newName) ?? (taken ? "A remote with this name exists" : null);
  const pullError =
    pullUrl.trim() === "" ? "Pull URL is required" : pullUrl.includes(HIDDEN) ? HIDDEN_MSG : null;
  const pushError = pushUrl.includes(HIDDEN) ? HIDDEN_MSG : null;
  const dirty = newName !== b.name || pullUrl.trim() !== b.pull || pushUrl.trim() !== b.push;

  const save = async (): Promise<boolean> => {
    const cur = { ...b };
    if (newName !== cur.name) {
      if (!(await renameRemote(repoId, cur.name, newName))) return false;
      cur.name = newName;
      setB({ ...cur });
    }
    if (pullUrl.trim() !== cur.pull) {
      if (!(await setRemoteUrl(repoId, cur.name, pullUrl.trim(), false))) return false;
      cur.pull = pullUrl.trim();
      setB({ ...cur });
    }
    if (pushUrl.trim() !== cur.push) {
      const url = pushUrl.trim() === "" ? pullUrl.trim() : pushUrl.trim();
      if (!(await setRemoteUrl(repoId, cur.name, url, true))) return false;
      cur.push = pushUrl.trim();
      setB({ ...cur });
    }
    return true;
  };

  return (
    <FormDialog
      title={`Edit ${name}`}
      submitLabel="Save"
      valid={nameError === null && pullError === null && pushError === null && dirty}
      initialFocusRef={nameRef}
      onClose={onClose}
      onSubmit={save}
    >
      <label className={styles["field"]}>
        <span className={styles["label"]}>Name</span>
        <input
          ref={nameRef}
          className={styles["input"]}
          value={newName}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setNewName(e.target.value)}
        />
      </label>
      {nameError !== null && (
        <div className={styles["error"]} role="alert">
          {nameError}
        </div>
      )}
      <label className={styles["field"]}>
        <span className={styles["label"]}>Pull URL</span>
        <input
          className={styles["input"]}
          value={pullUrl}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setPullUrl(e.target.value)}
        />
      </label>
      {pullError !== null && (
        <div className={styles["error"]} role="alert">
          {pullError}
        </div>
      )}
      <label className={styles["field"]}>
        <span className={styles["label"]}>Push URL</span>
        <input
          className={styles["input"]}
          value={pushUrl}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setPushUrl(e.target.value)}
        />
      </label>
      {pushError !== null && (
        <div className={styles["error"]} role="alert">
          {pushError}
        </div>
      )}
    </FormDialog>
  );
}
