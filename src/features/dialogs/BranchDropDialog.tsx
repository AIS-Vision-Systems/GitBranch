import { useRef } from "react";
import type { RepoId } from "../../ipc/types";
import { quotePath } from "../../lib/shellQuote";
import { useGraphStore } from "../../state/graph";
import { shortOid, useOpsStore } from "../../state/ops";
import { Dialog } from "../shell/Dialog";
import type { DropTargetKind } from "./open";
import styles from "./Form.module.css";

export interface BranchDropDialogProps {
  repoId: RepoId;
  /** The dragged local branch. */
  source: string;
  /** Ref name or oid. */
  target: string;
  targetLabel: string;
  targetKind: DropTargetKind;
  onClose: () => void;
}

/**
 * Local target: merge the source into it, or rebase the source onto it.
 * Remote-tracking branch or commit target: never merge into it; rebase the source onto it, or
 * merge it into the source. HEAD is never detached.
 */
export function BranchDropDialog({
  repoId,
  source,
  target,
  targetLabel,
  targetKind,
  onClose,
}: BranchDropDialogProps) {
  const head = useGraphStore((s) => s.byRepo[repoId]?.refs?.head ?? null);
  const inProgress = useGraphStore((s) => (s.byRepo[repoId]?.inProgress ?? null) !== null);
  const busy = useOpsStore((s) => s.busy);
  const merge = useOpsStore((s) => s.merge);
  const rebase = useOpsStore((s) => s.rebase);
  const checkout = useOpsStore((s) => s.checkout);
  const firstRef = useRef<HTMLButtonElement>(null);

  const disabled = busy || inProgress;
  const isCurrent = (name: string): boolean =>
    head !== null && !head.detached && head.branch === name;

  // Branch that ends up checked out, and the ref merged into it.
  const intoTarget = targetKind === "local";
  const mergeBranch = intoTarget ? target : source;
  const mergeFrom = intoTarget ? source : target;
  const mergeLabel = intoTarget
    ? `Merge ${source} into ${targetLabel}`
    : `Merge ${targetLabel} into ${source}`;
  const mergeCommand = isCurrent(mergeBranch)
    ? `git merge ${quotePath(shortOid(mergeFrom))}`
    : `git switch ${quotePath(mergeBranch)} && git merge ${quotePath(shortOid(mergeFrom))}`;
  const rebaseCommand = `git rebase ${quotePath(shortOid(target))} ${quotePath(source)}`;

  const doMerge = async (): Promise<void> => {
    if (!isCurrent(mergeBranch) && !(await checkout(repoId, mergeBranch, false))) return;
    if (await merge(repoId, mergeFrom, "default")) onClose();
  };
  const doRebase = async (): Promise<void> => {
    if (await rebase(repoId, target, source)) onClose();
  };

  const mergeButton = (ref?: typeof firstRef) => (
    <button
      ref={ref}
      type="button"
      className={styles["bigButton"]}
      disabled={disabled}
      onClick={() => void doMerge()}
    >
      <span>{mergeLabel}</span>
      <code className={styles["hint"]}>{mergeCommand}</code>
    </button>
  );
  const rebaseButton = (ref?: typeof firstRef) => (
    <button
      ref={ref}
      type="button"
      className={styles["bigButton"]}
      disabled={disabled}
      onClick={() => void doRebase()}
    >
      <span>{`Rebase ${source} onto ${targetLabel}`}</span>
      <code className={styles["hint"]}>{rebaseCommand}</code>
    </button>
  );

  return (
    <Dialog
      title={`${source} → ${targetLabel}`}
      onClose={onClose}
      width="sm"
      initialFocusRef={firstRef}
      footer={
        <button type="button" className={styles["cancel"]} onClick={onClose}>
          Cancel
        </button>
      }
    >
      <div className={styles["bigButtons"]}>
        {intoTarget ? (
          <>
            {mergeButton(firstRef)}
            {rebaseButton()}
          </>
        ) : (
          <>
            {rebaseButton(firstRef)}
            {mergeButton()}
          </>
        )}
      </div>
    </Dialog>
  );
}
