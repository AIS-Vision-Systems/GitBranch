import { useEffect, useMemo, useRef, useState } from "react";
import { pickRepoDir } from "../../ipc/repo";
import type { RepoId } from "../../ipc/types";
import { defaultWorktreePath, type WorktreeCheckout } from "../../ipc/worktree";
import { useGraphStore } from "../../state/graph";
import { reportError, useUiStore } from "../../state/ui";
import { worktreesOf, useWorktreesStore } from "../../state/worktrees";
import { FormDialog } from "./FormDialog";
import { validateAbsolutePath, validateRefName } from "./validate";
import styles from "./Form.module.css";

type Kind = "new" | "existing" | "detached";

export interface AddWorktreeDialogProps {
  repoId: RepoId;
  /** Oid or ref name; defaults to HEAD. */
  startPoint?: string;
  startLabel?: string;
  onClose: () => void;
}

const PATH_DEBOUNCE_MS = 200;

export function AddWorktreeDialog({
  repoId,
  startPoint,
  startLabel,
  onClose,
}: AddWorktreeDialogProps) {
  const initialStart = startPoint ?? "HEAD";
  const [kind, setKind] = useState<Kind>("new");
  const [name, setName] = useState("");
  const [start, setStart] = useState(initialStart);
  const [existing, setExisting] = useState("");
  const [revision, setRevision] = useState(initialStart);
  const [path, setPath] = useState("");
  const [pathEdited, setPathEdited] = useState(false);
  const [force, setForce] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  const refs = useGraphStore((s) => s.byRepo[repoId]?.refs?.refs);
  const worktrees = useWorktreesStore((s) => worktreesOf(s, repoId));
  const checkedOut = useMemo(
    () => new Set(worktrees.flatMap((w) => (w.branch !== null ? [w.branch] : []))),
    [worktrees],
  );
  const branches = useMemo(
    () => (refs ?? []).filter((r) => r.kind === "localBranch").map((r) => r.name),
    [refs],
  );
  const firstFree = branches.find((b) => !checkedOut.has(b)) ?? "";
  const selected = existing !== "" ? existing : firstFree;

  const pathName = kind === "new" ? name.trim() : kind === "existing" ? selected : "detached";

  useEffect(() => {
    if (pathEdited || pathName === "") return;
    let cancelled = false;
    const t = setTimeout(() => {
      defaultWorktreePath(repoId, pathName).then(
        (p) => {
          if (!cancelled) setPath(p);
        },
        () => {
          // Suggestion only; the user can type a path.
        },
      );
    }, PATH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [repoId, pathName, pathEdited]);

  const nameError = validateRefName(name);
  const pathError = validateAbsolutePath(path);
  let inputValid: boolean;
  if (kind === "new") inputValid = nameError === null && start.trim() !== "";
  else if (kind === "existing")
    inputValid = selected !== "" && (force || !checkedOut.has(selected));
  else inputValid = revision.trim() !== "";
  const valid = inputValid && pathError === null;

  const checkout = (): WorktreeCheckout => {
    if (kind === "new") return { kind, branch: name.trim(), startPoint: start.trim() };
    if (kind === "existing") return { kind, branch: selected };
    return { kind, revision: revision.trim() };
  };

  const browse = (): void => {
    pickRepoDir().then(
      (p) => {
        if (p === null) return;
        setPath(p);
        setPathEdited(true);
      },
      (e: unknown) => reportError(e, "Could not open the folder picker"),
    );
  };

  const submit = async (): Promise<boolean> => {
    const p = path.trim();
    const ok = await useWorktreesStore.getState().add(repoId, p, checkout(), force);
    if (ok)
      useUiStore.getState().pushToast({ kind: "success", title: "Worktree added", detail: p });
    return ok;
  };

  const radio = (k: Kind, label: string, first: boolean) => (
    <label className={styles["radio"]}>
      <input
        ref={first ? firstRef : undefined}
        type="radio"
        name="worktree-checkout"
        checked={kind === k}
        onChange={() => setKind(k)}
      />
      <span>{label}</span>
    </label>
  );

  return (
    <FormDialog
      title="Add worktree"
      submitLabel="Add"
      valid={valid}
      initialFocusRef={firstRef}
      onClose={onClose}
      onSubmit={submit}
    >
      {radio("new", "New branch", true)}
      {radio("existing", "Existing branch", false)}
      {radio("detached", "Detached", false)}

      {kind === "new" && (
        <>
          <label className={styles["field"]}>
            <span className={styles["label"]}>Branch name</span>
            <input
              className={styles["input"]}
              value={name}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {name !== "" && nameError !== null && (
            <div className={styles["error"]} role="alert">
              {nameError}
            </div>
          )}
          <label className={styles["field"]}>
            <span className={styles["label"]}>Start point</span>
            <input
              className={styles["input"]}
              value={start}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          {startLabel !== undefined && (
            <div className={styles["hint"]}>
              Starting at <code>{startLabel}</code>
            </div>
          )}
        </>
      )}

      {kind === "existing" && (
        <label className={styles["field"]}>
          <span className={styles["label"]}>Branch</span>
          <select
            className={styles["select"]}
            value={selected}
            onChange={(e) => setExisting(e.target.value)}
          >
            {branches.map((b) => {
              const busy = checkedOut.has(b);
              return (
                <option key={b} value={b} disabled={busy && !force}>
                  {busy ? `${b} (checked out)` : b}
                </option>
              );
            })}
          </select>
        </label>
      )}

      {kind === "detached" && (
        <label className={styles["field"]}>
          <span className={styles["label"]}>Revision</span>
          <input
            className={styles["input"]}
            value={revision}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setRevision(e.target.value)}
          />
        </label>
      )}

      <label className={styles["field"]}>
        <span className={styles["label"]}>Path</span>
        <span className={styles["pathRow"]}>
          <input
            className={styles["input"]}
            value={path}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setPath(e.target.value);
              setPathEdited(true);
            }}
          />
          <button type="button" className={styles["cancel"]} onClick={browse}>
            Browse…
          </button>
        </span>
      </label>
      {path !== "" && pathError !== null && (
        <div className={styles["error"]} role="alert">
          {pathError}
        </div>
      )}

      <label className={styles["check"]}>
        <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
        <span>Force</span>
      </label>
    </FormDialog>
  );
}
