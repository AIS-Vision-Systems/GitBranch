import { memo } from "react";
import type { RepoId } from "../../ipc/types";
import { EMPTY_PULLS, prMarks, usePullsStore } from "../../state/pulls";
import type { PrMark } from "../../state/pulls";
import { PullRequestIcon } from "./icons";
import styles from "./Graph.module.css";

const DOT: Partial<Record<PrMark["overall"], string>> = {
  success: "prDotSuccess",
  failure: "prDotFailure",
  pending: "prDotPending",
};

/** `#N` pull request badge (with a check dot) for a branch chip; `name` is the local or remote-tracking name. */
export const PrBadge = memo(function PrBadge({ repoId, name }: { repoId: RepoId; name: string }) {
  const mark = usePullsStore((s) => prMarks(s.byRepo[repoId] ?? EMPTY_PULLS).get(name));
  if (mark === undefined) return null;
  const dot = DOT[mark.overall];
  return (
    <button
      type="button"
      className={`${styles["prBadge"]} ${mark.draft ? (styles["prDraft"] ?? "") : ""}`}
      title={`#${mark.number} ${mark.title} · checks: ${mark.overall}`}
      onClick={(e) => {
        e.stopPropagation();
        void usePullsStore.getState().select(repoId, mark.number);
      }}
    >
      <PullRequestIcon />#{mark.number}
      {dot !== undefined && (
        <span
          data-testid="pr-dot"
          className={`${styles["prDot"]} ${styles[dot] ?? ""}`}
          aria-hidden="true"
        />
      )}
    </button>
  );
});
