import { useRef, useState } from "react";
import type { RepoId } from "../../ipc/types";
import { useOpsStore } from "../../state/ops";
import { remotesOf, useRemotesStore } from "../../state/remotes";
import { Dialog } from "../shell/Dialog";
import styles from "./Form.module.css";
import { validateRemoteName, validateRemoteUrl } from "./validate";

export interface RemotesDialogProps {
  repoId: RepoId;
  onClose: () => void;
}

export function RemotesDialog({ repoId, onClose }: RemotesDialogProps) {
  const remotes = useRemotesStore((s) => remotesOf(s, repoId));
  const busy = useOpsStore((s) => s.busy);
  const addRemote = useOpsStore((s) => s.addRemote);
  const removeRemote = useOpsStore((s) => s.removeRemote);
  const renameRemote = useOpsStore((s) => s.renameRemote);
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [addName, setAddName] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const firstRef = useRef<HTMLInputElement>(null);

  const taken = (n: string, except: string | null): boolean =>
    remotes.some((r) => r.name === n && r.name !== except);
  const addNameError = addName === "" ? null : validateRemoteName(addName);
  const addUrlError = addUrl === "" ? null : validateRemoteUrl(addUrl);
  const addValid =
    validateRemoteName(addName) === null &&
    validateRemoteUrl(addUrl) === null &&
    !taken(addName, null);
  const renameError = editing === null ? null : validateRemoteName(newName);
  const renameValid =
    editing !== null && renameError === null && newName !== editing && !taken(newName, editing);

  const doAdd = async (): Promise<void> => {
    if (!addValid || busy) return;
    if (await addRemote(repoId, addName, addUrl.trim())) {
      setAddName("");
      setAddUrl("");
    }
  };
  const doRename = async (): Promise<void> => {
    if (!renameValid || busy || editing === null) return;
    if (await renameRemote(repoId, editing, newName)) setEditing(null);
  };

  return (
    <Dialog
      title="Remotes"
      onClose={onClose}
      width="sm"
      initialFocusRef={firstRef}
      footer={
        <button type="button" className={styles["cancel"]} onClick={onClose}>
          Close
        </button>
      }
    >
      <div className={styles["form"]}>
        {remotes.length === 0 && <p className={styles["hint"]}>No remotes configured.</p>}
        <ul className={styles["todo"]} aria-label="Remotes">
          {remotes.map((r) => (
            <li key={r.name} className={styles["remoteRow"]}>
              {editing === r.name ? (
                <input
                  className={styles["input"]}
                  aria-label={`New name for ${r.name}`}
                  value={newName}
                  autoFocus
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void doRename();
                    } else if (e.key === "Escape") {
                      e.stopPropagation();
                      setEditing(null);
                    }
                  }}
                />
              ) : (
                <span className={styles["remoteName"]}>{r.name}</span>
              )}
              <span className={styles["remoteUrls"]}>
                <span className={styles["hint"]}>{r.fetchUrl}</span>
                {r.pushUrl !== null && r.pushUrl !== r.fetchUrl && (
                  <span className={styles["hint"]}>push: {r.pushUrl}</span>
                )}
              </span>
              {editing === r.name ? (
                <>
                  <button
                    type="button"
                    className={styles["cancel"]}
                    disabled={!renameValid || busy}
                    onClick={() => void doRename()}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className={styles["cancel"]}
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </button>
                  {renameError !== null && <span className={styles["error"]}>{renameError}</span>}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles["cancel"]}
                    disabled={busy}
                    onClick={() => {
                      setEditing(r.name);
                      setNewName(r.name);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className={styles["cancel"]}
                    disabled={busy}
                    onClick={() => void removeRemote(repoId, r.name)}
                  >
                    Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        <form
          className={styles["form"]}
          onSubmit={(e) => {
            e.preventDefault();
            void doAdd();
          }}
        >
          <label className={styles["field"]}>
            <span className={styles["label"]}>Name</span>
            <input
              ref={firstRef}
              className={styles["input"]}
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
            />
            {addNameError !== null && <span className={styles["error"]}>{addNameError}</span>}
            {addNameError === null && taken(addName, null) && (
              <span className={styles["error"]}>A remote with this name exists</span>
            )}
          </label>
          <label className={styles["field"]}>
            <span className={styles["label"]}>URL</span>
            <input
              className={styles["input"]}
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
            />
            {addUrlError !== null && <span className={styles["error"]}>{addUrlError}</span>}
          </label>
          <button type="submit" className={styles["submit"]} disabled={!addValid || busy}>
            Add remote
          </button>
        </form>
      </div>
    </Dialog>
  );
}
