import { useMemo, type KeyboardEvent } from "react";
import { useReposStore } from "../../state/repos";
import { orderTabs } from "../../lib/tabOrder";
import styles from "./RepoTabs.module.css";

const tabDomId = (repoId: string): string => `repo-tab-${repoId}`;

export function RepoTabs() {
  const open = useReposStore((s) => s.open);
  const currentId = useReposStore((s) => s.currentId);
  const select = useReposStore((s) => s.select);
  const close = useReposStore((s) => s.close);
  const tabs = useMemo(() => orderTabs(open), [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, repoId: string): void => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(repoId);
      return;
    }
    const i = tabs.findIndex((r) => r.repoId === repoId);
    let to = -1;
    if (e.key === "ArrowRight") to = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") to = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = tabs.length - 1;
    const target = tabs[to];
    if (target === undefined) return;
    e.preventDefault();
    select(target.repoId);
    document.getElementById(tabDomId(target.repoId))?.focus();
  };

  return (
    <div role="tablist" aria-label="Open repositories" className={styles["tabs"]}>
      {tabs.map((r) => {
        const active = r.repoId === currentId;
        const title =
          r.isWorktree && r.mainWorkTree !== null ? `Worktree of ${r.mainWorkTree}` : r.path;
        return (
          <div key={r.repoId} className={styles["entry"]}>
            <div
              id={tabDomId(r.repoId)}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={title}
              className={active ? `${styles["tab"]} ${styles["active"]}` : styles["tab"]}
              onClick={() => select(r.repoId)}
              onKeyDown={(e) => onKeyDown(e, r.repoId)}
            >
              {r.isWorktree && <span aria-hidden="true">⧉</span>}
              <span className={styles["label"]}>{r.name}</span>
              {r.isBare && <span className={styles["bare"]}>(bare)</span>}
            </div>
            <button
              type="button"
              tabIndex={-1}
              className={styles["close"]}
              aria-label={`Close ${r.name}`}
              onClick={() => void close(r.repoId)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
