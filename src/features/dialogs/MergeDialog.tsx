import { useRef, useState } from "react";
import type { MergeMode } from "../../ipc/merge";
import type { RepoId } from "../../ipc/types";
import { useOpsStore } from "../../state/ops";
import { FormDialog } from "./FormDialog";
import styles from "./Form.module.css";

export interface MergeDialogProps {
  repoId: RepoId;
  /** Ref name or oid passed to `git merge`. */
  source: string;
  sourceLabel: string;
  current: string;
  onClose: () => void;
}

const MODES: { mode: MergeMode; label: string; help: string }[] = [
  {
    mode: "default",
    label: "Merge (fast-forward if possible)",
    help: "Moves the branch forward when it can, otherwise creates a merge commit.",
  },
  {
    mode: "fastForwardOnly",
    label: "Fast-forward only",
    help: "Fails if a merge commit is needed.",
  },
  {
    mode: "noFastForward",
    label: "Create a merge commit (--no-ff)",
    help: "Always records a merge commit.",
  },
  { mode: "squash", label: "Squash", help: "Stages the combined changes; you commit afterwards." },
];

export function MergeDialog({ repoId, source, sourceLabel, current, onClose }: MergeDialogProps) {
  const [mode, setMode] = useState<MergeMode>("default");
  const firstRef = useRef<HTMLInputElement>(null);
  const merge = useOpsStore((s) => s.merge);

  return (
    <FormDialog
      title="Merge"
      submitLabel={`Merge ${sourceLabel} into ${current}`}
      valid
      initialFocusRef={firstRef}
      onClose={onClose}
      onSubmit={() => merge(repoId, source, mode)}
    >
      {MODES.map((m) => (
        <label key={m.mode} className={styles["radio"]}>
          <input
            ref={m.mode === "default" ? firstRef : undefined}
            type="radio"
            name="merge-mode"
            value={m.mode}
            checked={mode === m.mode}
            onChange={() => setMode(m.mode)}
          />
          <span className={styles["radioText"]}>
            <span>{m.label}</span>
            <span className={styles["hint"]}>{m.help}</span>
          </span>
        </label>
      ))}
    </FormDialog>
  );
}
