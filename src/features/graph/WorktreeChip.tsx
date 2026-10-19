import { memo } from "react";
import { useReposStore } from "../../state/repos";
import type { WorktreeMark } from "./worktreeMarks";
import styles from "./Graph.module.css";

/** Marks a commit that another linked worktree has checked out; click opens that worktree's tab. */
export const WorktreeChip = memo(function WorktreeChip({ mark }: { mark: WorktreeMark }) {
  const title =
    `Checked out in worktree ${mark.path}` + (mark.branch !== null ? ` on ${mark.branch}` : "");
  return (
    <button
      type="button"
      className={`${styles["chip"]} ${styles["worktree"]}`}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        void useReposStore.getState().openWorktree(mark.path);
      }}
    >
      <span aria-hidden="true">⧉</span>
      <span>{mark.label}</span>
    </button>
  );
});
