import { useRef, useState } from "react";
import { pickRepoDir } from "../../ipc/repo";
import { reportError } from "../../state/ui";
import { useOpsStore } from "../../state/ops";
import { FormDialog } from "./FormDialog";
import { cloneNameFromUrl, joinClonePath, validateCloneName, validateCloneUrl } from "./validate";
import styles from "./Form.module.css";

export const CLONE_PARENT_KEY = "gitbranch.clone.parent";

function loadParent(): string {
  try {
    return localStorage.getItem(CLONE_PARENT_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveParent(p: string): void {
  try {
    localStorage.setItem(CLONE_PARENT_KEY, p);
  } catch {
    // storage unavailable: not remembering is fine
  }
}

export interface CloneDialogProps {
  onClose: () => void;
}

export function CloneDialog({ onClose }: CloneDialogProps) {
  const clone = useOpsStore((s) => s.clone);
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState(loadParent);
  // null = follow the URL.
  const [nameSel, setNameSel] = useState<string | null>(null);
  const [branch, setBranch] = useState("");
  const [shallow, setShallow] = useState(false);
  const [depth, setDepth] = useState("1");
  const [recurse, setRecurse] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  const name = nameSel ?? cloneNameFromUrl(url);
  const dest = joinClonePath(parent, name);
  const depthNum = Number(depth);
  const depthOk = !shallow || (Number.isInteger(depthNum) && depthNum >= 1);
  const urlError = url === "" ? null : validateCloneUrl(url);
  const nameError = name === "" ? null : validateCloneName(name);
  const valid =
    validateCloneUrl(url) === null && validateCloneName(name) === null && parent !== "" && depthOk;

  const browse = (): void => {
    pickRepoDir().then(
      (p) => {
        if (p === null) return;
        setParent(p);
        saveParent(p);
      },
      (e: unknown) => reportError(e, "Could not pick a folder"),
    );
  };

  return (
    <FormDialog
      title="Clone repository"
      submitLabel="Clone"
      valid={valid}
      initialFocusRef={urlRef}
      onClose={onClose}
      onSubmit={async () =>
        (await clone({
          url: url.trim(),
          dest,
          branch: branch.trim() === "" ? null : branch.trim(),
          depth: shallow ? depthNum : null,
          recurseSubmodules: recurse,
        })) !== null
      }
    >
      <label className={styles["field"]}>
        <span className={styles["label"]}>URL</span>
        <input
          ref={urlRef}
          className={styles["input"]}
          value={url}
          placeholder="https://github.com/owner/repo.git"
          onChange={(e) => setUrl(e.target.value)}
        />
        {urlError !== null && <span className={styles["error"]}>{urlError}</span>}
      </label>
      <div className={styles["field"]}>
        <span className={styles["label"]}>Parent folder</span>
        <div className={styles["row"]}>
          <input
            className={styles["input"]}
            aria-label="Parent folder"
            value={parent}
            onChange={(e) => {
              setParent(e.target.value);
              saveParent(e.target.value);
            }}
            placeholder="Choose a folder or type a path"
          />
          <button type="button" className={styles["cancel"]} onClick={browse}>
            Browse…
          </button>
        </div>
      </div>
      <label className={styles["field"]}>
        <span className={styles["label"]}>Name</span>
        <input
          className={styles["input"]}
          value={name}
          onChange={(e) => setNameSel(e.target.value)}
        />
        {nameError !== null && <span className={styles["error"]}>{nameError}</span>}
      </label>
      <p className={styles["hint"]}>{parent === "" || name === "" ? "" : `Clones into ${dest}`}</p>
      <label className={styles["field"]}>
        <span className={styles["label"]}>Branch</span>
        <input
          className={styles["input"]}
          value={branch}
          placeholder="Remote default"
          onChange={(e) => setBranch(e.target.value)}
        />
      </label>
      <label className={styles["check"]}>
        <input type="checkbox" checked={shallow} onChange={(e) => setShallow(e.target.checked)} />{" "}
        Shallow clone
      </label>
      <label className={styles["field"]}>
        <span className={styles["label"]}>Depth</span>
        <input
          className={styles["input"]}
          type="number"
          min={1}
          step={1}
          value={depth}
          disabled={!shallow}
          onChange={(e) => setDepth(e.target.value)}
        />
      </label>
      <label className={styles["check"]}>
        <input type="checkbox" checked={recurse} onChange={(e) => setRecurse(e.target.checked)} />{" "}
        Recurse submodules
      </label>
    </FormDialog>
  );
}
