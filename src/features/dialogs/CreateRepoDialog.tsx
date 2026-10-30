import { useRef, useState } from "react";
import { pickRepoDir } from "../../ipc/repo";
import { reportError } from "../../state/ui";
import { useOpsStore } from "../../state/ops";
import { CLONE_PARENT_KEY } from "./CloneDialog";
import { FormDialog } from "./FormDialog";
import { joinClonePath, validateCloneName, validateInitialBranch } from "./validate";
import styles from "./Form.module.css";

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

export interface CreateRepoDialogProps {
  onClose: () => void;
}

export function CreateRepoDialog({ onClose }: CreateRepoDialogProps) {
  const initRepo = useOpsStore((s) => s.initRepo);
  const [parent, setParent] = useState(loadParent);
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("main");
  const [readme, setReadme] = useState(true);
  const nameRef = useRef<HTMLInputElement>(null);

  const dest = joinClonePath(parent, name);
  const nameError = name === "" ? null : validateCloneName(name);
  const branchError = validateInitialBranch(branch);
  const valid =
    parent.trim() !== "" &&
    validateCloneName(name) === null &&
    validateInitialBranch(branch) === null;

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
      title="Create repository"
      submitLabel="Create"
      valid={valid}
      initialFocusRef={nameRef}
      onClose={onClose}
      onSubmit={async () =>
        (await initRepo({
          dest,
          initialBranch: branch.trim() === "" ? null : branch.trim(),
          readme,
        })) !== null
      }
    >
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
          ref={nameRef}
          className={styles["input"]}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {nameError !== null && <span className={styles["error"]}>{nameError}</span>}
      </label>
      <p className={styles["hint"]}>{parent === "" || name === "" ? "" : `Creates ${dest}`}</p>
      <label className={styles["field"]}>
        <span className={styles["label"]}>Initial branch</span>
        <input
          className={styles["input"]}
          value={branch}
          placeholder="Git default"
          onChange={(e) => setBranch(e.target.value)}
        />
        {branchError !== null && <span className={styles["error"]}>{branchError}</span>}
      </label>
      <label className={styles["check"]}>
        <input type="checkbox" checked={readme} onChange={(e) => setReadme(e.target.checked)} /> Add
        a README and an initial commit
      </label>
    </FormDialog>
  );
}
