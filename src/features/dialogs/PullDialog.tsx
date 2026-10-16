import { useEffect, useRef, useState } from "react";
import { defaultPullMode, type PullMode } from "../../ipc/remote";
import type { RepoId } from "../../ipc/types";
import { preferredRemote, upstreamBranch, upstreamRemote } from "../../lib/pushTarget";
import { useGraphStore } from "../../state/graph";
import { useOpsStore } from "../../state/ops";
import { remotesOf, useRemotesStore } from "../../state/remotes";
import { FormDialog } from "./FormDialog";
import styles from "./Form.module.css";

export interface PullDialogProps {
  repoId: RepoId;
  onClose: () => void;
}

const MODE_LABEL: Record<Exclude<PullMode, "config">, string> = {
  ffOnly: "fast-forward only",
  rebase: "rebase",
  merge: "merge",
};

export function PullDialog({ repoId, onClose }: PullDialogProps) {
  const remotes = useRemotesStore((s) => remotesOf(s, repoId));
  const refs = useGraphStore((s) => s.byRepo[repoId]?.refs ?? null);
  const pull = useOpsStore((s) => s.pull);
  const headRef = refs?.refs.find((r) => r.kind === "localBranch" && r.isHead);
  const up = headRef?.upstream ?? null;
  const live = up !== null && !up.gone ? up.name : null;
  // null = untouched: follow the defaults, which change when remotes/refs load late.
  const [remoteSel, setRemoteSel] = useState<string | null>(null);
  const [branchSel, setBranchSel] = useState<string | null>(null);
  const remote = remoteSel ?? (remotes.length > 0 ? preferredRemote(up, remotes) : "");
  const branch =
    branchSel ??
    (upstreamRemote(live, remotes) === remote ? upstreamBranch(live, remotes) : null) ??
    "";
  const [mode, setMode] = useState<PullMode>("config");
  const [resolved, setResolved] = useState<Exclude<PullMode, "config"> | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    let cancelled = false;
    defaultPullMode(repoId).then(
      (m) => {
        if (!cancelled) setResolved(m);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [repoId]);

  const modes: { mode: PullMode; label: string }[] = [
    {
      mode: "config",
      label: `Repository default (${resolved === null ? "…" : MODE_LABEL[resolved]})`,
    },
    { mode: "ffOnly", label: "Fast-forward only" },
    { mode: "rebase", label: "Rebase" },
    { mode: "merge", label: "Merge" },
  ];

  return (
    <FormDialog
      title="Pull"
      submitLabel="Pull"
      valid={remote !== ""}
      initialFocusRef={selectRef}
      onClose={onClose}
      onSubmit={() =>
        pull(repoId, { remote, branch: branch.trim() === "" ? null : branch.trim(), mode })
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
          placeholder="Git default"
          onChange={(e) => setBranchSel(e.target.value)}
        />
      </label>
      {modes.map((m) => (
        <label key={m.mode} className={styles["radio"]}>
          <input
            type="radio"
            name="pull-mode"
            value={m.mode}
            checked={mode === m.mode}
            onChange={() => setMode(m.mode)}
          />
          <span className={styles["radioText"]}>{m.label}</span>
        </label>
      ))}
    </FormDialog>
  );
}
