import { useRef, useState } from "react";
import type { RepoId } from "../../ipc/types";
import { pushDefaults, upstreamBranch, upstreamRemote } from "../../lib/pushTarget";
import { useGraphStore } from "../../state/graph";
import { useOpsStore } from "../../state/ops";
import { remotesOf, useRemotesStore } from "../../state/remotes";
import { FormDialog } from "./FormDialog";
import styles from "./Form.module.css";

export interface PushDialogProps {
  repoId: RepoId;
  /** Local branch to push; null = the current branch. */
  branch: string | null;
  onClose: () => void;
}

export function PushDialog({ repoId, branch: requested, onClose }: PushDialogProps) {
  const remotes = useRemotesStore((s) => remotesOf(s, repoId));
  const refs = useGraphStore((s) => s.byRepo[repoId]?.refs ?? null);
  const push = useOpsStore((s) => s.push);
  const defaults = pushDefaults(refs, remotes, requested);
  const detached = requested === null && (refs?.head.branch ?? null) === null;
  // null = untouched: follow the defaults, which change when remotes/refs load late.
  const [remoteSel, setRemoteSel] = useState<string | null>(null);
  const [branchSel, setBranchSel] = useState<string | null>(null);
  const [upstreamSel, setUpstreamSel] = useState<boolean | null>(null);
  const remote = remoteSel ?? defaults?.remote ?? remotes[0]?.name ?? "";
  const branch = branchSel ?? defaults?.branch ?? "";
  const up = refs?.refs.find((r) => r.kind === "localBranch" && r.name === branch.trim())?.upstream;
  const upName = up !== undefined && up !== null && !up.gone ? up.name : null;
  const trackedHere = upName !== null && upstreamRemote(upName, remotes) === remote;
  const remoteBranch = trackedHere ? upstreamBranch(upName, remotes) : null;
  const setUpstream = upstreamSel ?? !trackedHere;
  const [tags, setTags] = useState(false);
  const [lease, setLease] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  return (
    <FormDialog
      title="Push"
      submitLabel={lease ? "Force push (with lease)" : "Push"}
      valid={remote !== "" && !detached && branch.trim() !== ""}
      initialFocusRef={selectRef}
      onClose={onClose}
      onSubmit={() =>
        push(repoId, {
          remote,
          branch: branch.trim(),
          remoteBranch,
          setUpstream,
          tags,
          forceWithLease: lease,
        })
      }
    >
      <label className={styles["field"]}>
        <span className={styles["label"]}>Remote</span>
        <select
          ref={selectRef}
          className={styles["select"]}
          value={remote}
          onChange={(e) => setRemoteSel(e.target.value)}
        >
          {remotes.map((r) => (
            <option key={r.name} value={r.name}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles["field"]}>
        <span className={styles["label"]}>Branch</span>
        <input
          className={styles["input"]}
          value={branch}
          disabled={detached}
          onChange={(e) => setBranchSel(e.target.value)}
        />
        {remoteBranch !== null && (
          <span className={styles["hint"]}>
            → {remote}/{remoteBranch}
          </span>
        )}
        {detached && (
          <span className={styles["hint"]}>HEAD is detached; check out a branch to push it.</span>
        )}
      </label>
      <label className={styles["check"]}>
        <input
          type="checkbox"
          checked={setUpstream}
          onChange={(e) => setUpstreamSel(e.target.checked)}
        />{" "}
        Set upstream
      </label>
      <label className={styles["check"]}>
        <input type="checkbox" checked={tags} onChange={(e) => setTags(e.target.checked)} /> Push
        tags
      </label>
      <label className={styles["check"]}>
        <input type="checkbox" checked={lease} onChange={(e) => setLease(e.target.checked)} /> Force
        with lease
      </label>
      {lease && (
        <p className={styles["hint"]}>
          Overwrites the remote branch only if it still matches what you last fetched.
        </p>
      )}
    </FormDialog>
  );
}
