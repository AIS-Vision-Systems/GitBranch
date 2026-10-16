import { useRef, useState } from "react";
import type { ResetMode } from "../../ipc/history";
import type { RepoId } from "../../ipc/types";
import { useOpsStore } from "../../state/ops";
import { FormDialog } from "./FormDialog";
import styles from "./Form.module.css";

export interface ResetDialogProps {
  repoId: RepoId;
  target: string;
  targetLabel: string;
  onClose: () => void;
}

const MODES: { mode: ResetMode; label: string; help: string }[] = [
  { mode: "soft", label: "Soft", help: "Keep all changes staged." },
  { mode: "mixed", label: "Mixed", help: "Keep changes in the working tree, unstaged." },
  { mode: "hard", label: "Hard", help: "Discard all uncommitted changes." },
];

export function ResetDialog({ repoId, target, targetLabel, onClose }: ResetDialogProps) {
  const [mode, setMode] = useState<ResetMode>("mixed");
  const firstRef = useRef<HTMLInputElement>(null);
  const reset = useOpsStore((s) => s.reset);

  return (
    <FormDialog
      title="Reset current branch"
      submitLabel="Continue"
      valid
      initialFocusRef={firstRef}
      onClose={onClose}
      // The store asks for confirmation before running git reset.
      onSubmit={() => reset(repoId, target, mode)}
    >
      <div className={styles["hint"]}>
        Move the current branch to <code>{targetLabel}</code>
      </div>
      {MODES.map((m) => (
        <label key={m.mode} className={styles["radio"]}>
          <input
            ref={m.mode === "mixed" ? firstRef : undefined}
            type="radio"
            name="reset-mode"
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
