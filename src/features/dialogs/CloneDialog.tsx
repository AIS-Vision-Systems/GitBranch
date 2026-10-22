import { useEffect, useRef, useState } from "react";
import { listRemoteHeads } from "../../ipc/clone";
import { isIpcError } from "../../ipc/core";
import { cancelOp } from "../../ipc/progress";
import { pickRepoDir } from "../../ipc/repo";
import { buildBranchOptions, isLookupReady, shortReason } from "./cloneBranches";
import { openGithubRepoPicker } from "./open";
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
  initialUrl?: string;
  /** Known default branch (GitHub picker): shown before the remote answers. */
  initialDefaultBranch?: string;
  onClose: () => void;
}

const LIST_DEBOUNCE_MS = 500;

type HeadsResult =
  | { status: "ok"; defaultBranch: string | null; branches: string[] }
  | { status: "error"; reason: string };
type HeadsState = { status: "idle" } | { status: "loading" } | HeadsResult;

export function CloneDialog({ initialUrl, initialDefaultBranch, onClose }: CloneDialogProps) {
  const clone = useOpsStore((s) => s.clone);
  const [url, setUrl] = useState(initialUrl ?? "");
  const [parent, setParent] = useState(loadParent);
  // null = follow the URL.
  const [nameSel, setNameSel] = useState<string | null>(null);
  // Selection and lookup result are keyed by URL, so a URL change invalidates them without an effect.
  const [branchSel, setBranchSel] = useState({ url: "", value: "" });
  const [shallow, setShallow] = useState(false);
  const [depth, setDepth] = useState("1");
  const [recurse, setRecurse] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<{ url: string; res: HeadsResult } | null>(null);

  const trimmedUrl = url.trim();
  const urlValid = validateCloneUrl(url) === null && isLookupReady(url);
  const heads: HeadsState = !urlValid
    ? { status: "idle" }
    : result !== null && result.url === trimmedUrl
      ? result.res
      : { status: "loading" };
  const rawBranch = branchSel.url === trimmedUrl ? branchSel.value : "";
  const setBranch = (value: string): void => setBranchSel({ url: trimmedUrl, value });

  useEffect(() => {
    if (!urlValid) return;
    let stale = false;
    let opId: string | null = null;
    let done = false;
    const timer = setTimeout(() => {
      const id = crypto.randomUUID();
      opId = id;
      listRemoteHeads(trimmedUrl, id).then(
        (h) => {
          done = true;
          if (stale) return;
          setResult({
            url: trimmedUrl,
            res: { status: "ok", defaultBranch: h.defaultBranch, branches: h.branches },
          });
        },
        (e: unknown) => {
          done = true;
          if (stale || (isIpcError(e) && e.error.code.endsWith("cancelled"))) return;
          setResult({ url: trimmedUrl, res: { status: "error", reason: shortReason(e) } });
        },
      );
    }, LIST_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
      if (opId !== null && !done) cancelOp(opId).catch(() => undefined);
    };
  }, [urlValid, trimmedUrl]);

  const options = buildBranchOptions(
    heads.status === "ok" ? (heads.defaultBranch ?? initialDefaultBranch) : initialDefaultBranch,
    heads.status === "ok" ? heads.branches : [],
  );
  // What the select shows is exactly what clone sends; the text fallback sends what was typed.
  const branch =
    heads.status === "error" || options.some((o) => o.value === rawBranch) ? rawBranch : "";

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
        <span className={styles["label"]}>
          URL{" "}
          <button
            type="button"
            className={styles["linkButton"]}
            onClick={() => {
              onClose();
              openGithubRepoPicker();
            }}
          >
            Pick from GitHub…
          </button>
        </span>
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
        {heads.status === "error" ? (
          <>
            <input
              className={styles["input"]}
              value={branch}
              placeholder="Remote default"
              onChange={(e) => setBranch(e.target.value)}
            />
            <span className={styles["hint"]}>Could not list branches: {heads.reason}</span>
          </>
        ) : (
          <>
            <select
              className={styles["input"]}
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {heads.status === "loading" && (
              <span className={styles["hint"]}>Loading branches…</span>
            )}
          </>
        )}
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
