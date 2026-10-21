import type { HunkSelection, PatchOp } from "../../ipc/stage";
import type { DiffTarget } from "../../ipc/commit";
import type { RepoId } from "../../ipc/types";
import { sameTarget, useDetailsStore } from "../../state/details";
import { useWipStore } from "../../state/wip";
import { DiffView } from "./DiffView";
import styles from "./Diff.module.css";

const SHORT_OID = 7;

function kindLabel(t: DiffTarget): string {
  switch (t.kind) {
    case "commit":
      return t.oid.slice(0, SHORT_OID);
    case "staged":
      return "Staged";
    case "unstaged":
      return "Unstaged";
    case "untracked":
      return "Untracked";
  }
}

/** The selected file's diff, shown in the center pane in place of the graph. */
export function CenterDiff({ repoId }: { repoId: RepoId }) {
  const selectedFile = useDetailsStore((s) => s.selectedFile);
  const diff = useDetailsStore((s) => s.diff);
  const loading = useDetailsStore((s) => s.loadingDiff);
  const view = useDetailsStore((s) => s.view);
  const setView = useDetailsStore((s) => s.setView);
  const reloadFile = useDetailsStore((s) => s.reloadFile);
  const clear = useDetailsStore((s) => s.clear);

  if (selectedFile === null) return null;

  const onHunkOp = async (sel: HunkSelection, op: PatchOp): Promise<void> => {
    const ok = await useWipStore.getState().applyHunk(repoId, sel, op);
    // On a stale error the store already reloaded the diff.
    if (!ok) return;
    // The selection may have moved while the op ran; only reload the same file.
    const now = useDetailsStore.getState().selectedFile;
    if (now !== null && sameTarget(now.target, selectedFile.target)) {
      await reloadFile(repoId, now.target, now.label);
    }
  };

  return (
    <div className={styles["center"]}>
      <div className={styles["centerHeader"]}>
        <span className={styles["label"]} title={selectedFile.label}>
          {selectedFile.label}
        </span>
        <span className={styles["centerKind"]}>{kindLabel(selectedFile.target)}</span>
        <button type="button" className={styles["close"]} aria-label="Close diff" onClick={clear}>
          ×
        </button>
      </div>
      <DiffView
        diff={diff}
        loading={loading}
        label={selectedFile.label}
        hideLabel
        view={view}
        onViewChange={setView}
        target={selectedFile.target}
        onHunkOp={onHunkOp}
      />
    </div>
  );
}
