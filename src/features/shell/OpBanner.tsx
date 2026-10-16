import type { RepoId } from "../../ipc/types";
import { useGraphStore } from "../../state/graph";
import { useOpsStore } from "../../state/ops";
import { opBannerText } from "./opBannerText";
import styles from "./OpBanner.module.css";

interface Props {
  repoId: RepoId;
}

/** Shown above the main area while a merge/rebase/cherry-pick/revert is stopped. */
export function OpBanner({ repoId }: Props) {
  const inProgress = useGraphStore((s) => s.byRepo[repoId]?.inProgress ?? null);
  const conflicts = useGraphStore(
    (s) => s.byRepo[repoId]?.status?.entries.filter((e) => e.conflicted).length ?? 0,
  );
  const busy = useOpsStore((s) => s.busy);
  const abort = useOpsStore((s) => s.opAbort);
  const cont = useOpsStore((s) => s.opContinue);
  const skip = useOpsStore((s) => s.opSkip);
  if (inProgress === null) return null;
  const { kind } = inProgress;
  const blocked = conflicts > 0;

  return (
    <div className={styles["banner"]} role="status" aria-label="Operation in progress">
      <span className={styles["text"]}>{opBannerText(inProgress)}</span>
      <span className={styles["count"]}>
        {blocked ? `${conflicts} conflicted ${conflicts === 1 ? "file" : "files"}` : "No conflicts"}
      </span>
      <button
        type="button"
        className={styles["button"]}
        disabled={busy}
        onClick={() => void abort(repoId, kind)}
      >
        Abort
      </button>
      <button
        type="button"
        className={styles["button"]}
        disabled={busy || blocked}
        title={blocked ? "Resolve all conflicts first" : `Continue the ${kind}`}
        onClick={() => void cont(repoId, kind)}
      >
        Continue
      </button>
      {kind !== "merge" && (
        <button
          type="button"
          className={styles["button"]}
          disabled={busy}
          onClick={() => void skip(repoId, kind)}
        >
          Skip
        </button>
      )}
    </div>
  );
}
