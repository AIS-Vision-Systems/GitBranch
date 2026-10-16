import { useState } from "react";
import { formatRelative } from "../../lib/time";
import type { RepoId } from "../../ipc/types";
import { useGraphStore } from "../../state/graph";
import { useOpsStore } from "../../state/ops";
import styles from "./StashList.module.css";

interface Props {
  repoId: RepoId;
  /** Called after "Show" so a popover host can close itself. */
  onShown?: () => void;
}

const NO_STASHES: never[] = [];

export function StashList({ repoId, onShown }: Props) {
  const stashes = useGraphStore((s) => s.byRepo[repoId]?.stashes ?? NO_STASHES);
  const busy = useOpsStore((s) => s.busy);
  const apply = useOpsStore((s) => s.stashApply);
  const pop = useOpsStore((s) => s.stashPop);
  const drop = useOpsStore((s) => s.stashDrop);
  const select = useGraphStore((s) => s.select);
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  if (stashes.length === 0) return <div className={styles["empty"]}>No stashes</div>;

  return (
    <ul className={styles["list"]} aria-label="Stashes">
      {stashes.map((s) => (
        <li key={s.oid} className={styles["entry"]}>
          <div className={styles["head"]}>
            <span className={styles["name"]}>{`stash@{${s.index}}`}</span>
            <span className={styles["meta"]}>
              {s.branch !== null ? `${s.branch} · ` : ""}
              {formatRelative(s.time, now)}
            </span>
          </div>
          <div className={styles["message"]} title={s.message}>
            {s.message}
          </div>
          <div className={styles["actions"]}>
            <button type="button" disabled={busy} onClick={() => void apply(repoId, s)}>
              Apply
            </button>
            <button type="button" disabled={busy} onClick={() => void pop(repoId, s)}>
              Pop
            </button>
            <button
              type="button"
              className={styles["danger"]}
              disabled={busy}
              onClick={() => void drop(repoId, s)}
            >
              Drop
            </button>
            <button
              type="button"
              onClick={() => {
                select(s.oid);
                onShown?.();
              }}
            >
              Show
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
