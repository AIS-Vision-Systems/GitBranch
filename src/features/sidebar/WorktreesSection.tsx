import type { KeyboardEvent } from "react";
import type { RepoId } from "../../ipc/types";
import type { Worktree } from "../../ipc/worktree";
import { confirm } from "../../state/dialogs";
import { useReposStore } from "../../state/repos";
import { worktreesOf, useWorktreesStore } from "../../state/worktrees";
import { openAddWorktree, openLockWorktree } from "../dialogs/open";
import { FolderGit2 } from "../../lib/icons";
import { samePath } from "../../lib/paths";
import { filterWorktrees, useWorktreeCount } from "./counts";
import { SidebarSection } from "./SidebarSection";
import styles from "./Sidebar.module.css";

function title(w: Worktree): string {
  if (w.isBare) return "bare";
  if (w.isDetached) return `detached @ ${(w.headOid ?? "").slice(0, 7)}`;
  return w.branch ?? "(unknown)";
}

function WorktreeRow({
  repoId,
  w,
  currentPath,
}: {
  repoId: RepoId;
  w: Worktree;
  currentPath: string | null;
}) {
  const remove = useWorktreesStore((s) => s.remove);
  const unlock = useWorktreesStore((s) => s.unlock);
  const current = currentPath !== null && samePath(w.path, currentPath);
  const clickable = !w.isBare && !current;

  const open = (): void => {
    if (clickable) void useReposStore.getState().openWorktree(w.path);
  };

  const onRemove = async (): Promise<void> => {
    await confirm({
      title: "Remove worktree?",
      message: `${w.path}\nIts folder and any ignored files in it are deleted.`,
      confirmLabel: "Remove",
      danger: true,
      onConfirm: async () => {
        const r = await remove(repoId, w.path, false);
        if (r.ok || !r.needsForce) return;
        void confirm({
          title: "Force remove worktree?",
          message: r.message,
          confirmLabel: "Force remove",
          danger: true,
          onConfirm: async () => {
            await remove(repoId, w.path, true);
          },
        });
      },
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Enter" && e.target === e.currentTarget) {
      e.preventDefault();
      open();
    }
  };

  const cls = [
    styles["row"],
    clickable ? "" : styles["rowStatic"],
    current ? styles["rowCurrent"] : "",
  ]
    .filter((c) => c !== "")
    .join(" ");

  return (
    <div
      role="listitem"
      className={cls}
      tabIndex={clickable ? 0 : undefined}
      aria-current={current ? "true" : undefined}
      onClick={open}
      onKeyDown={onKeyDown}
    >
      <div className={styles["line1"]}>
        <span className={styles["branch"]}>{title(w)}</span>
        {w.isMain && <span className={styles["badge"]}>main</span>}
        {current && <span className={`${styles["badge"]} ${styles["badgeCurrent"]}`}>current</span>}
        {w.locked && (
          <span
            className={`${styles["badge"]} ${styles["badgeLocked"]}`}
            title={w.lockReason ?? "locked"}
          >
            locked
          </span>
        )}
        {w.prunable && (
          <span
            className={`${styles["badge"]} ${styles["badgePrunable"]}`}
            title={w.pruneReason ?? "prunable"}
          >
            prunable
          </span>
        )}
      </div>
      <div className={styles["path"]} title={w.path}>
        {w.path}
      </div>
      <div className={styles["actions"]} onClick={(e) => e.stopPropagation()}>
        {w.isMain ? null : w.locked ? (
          <button
            type="button"
            className={styles["rowAction"]}
            aria-label="Unlock"
            onClick={() => void unlock(repoId, w.path)}
          >
            Unlock
          </button>
        ) : (
          <button
            type="button"
            className={styles["rowAction"]}
            aria-label="Lock"
            onClick={() => openLockWorktree(repoId, w.path)}
          >
            Lock
          </button>
        )}
        {!w.isMain && !current && (
          <button
            type="button"
            className={styles["rowAction"]}
            aria-label="Remove"
            onClick={() => void onRemove()}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

export function WorktreesSection({ repoId, query = "" }: { repoId: RepoId; query?: string }) {
  const all = useWorktreesStore((s) => worktreesOf(s, repoId));
  const prune = useWorktreesStore((s) => s.prune);
  const currentPath = useReposStore(
    (s) => s.open.find((r) => r.repoId === s.currentId)?.path ?? null,
  );
  const count = useWorktreeCount(repoId, query);
  const anyPrunable = all.some((w) => w.prunable);
  const q = query.trim().toLowerCase();
  const list = filterWorktrees(all, q);

  return (
    <SidebarSection
      id="worktrees"
      icon={<FolderGit2 size={14} />}
      title="Worktrees"
      count={count}
      actions={
        <>
          <button
            type="button"
            className={styles["headerAction"]}
            onClick={() => openAddWorktree(repoId)}
          >
            Add…
          </button>
          <button
            type="button"
            className={styles["headerAction"]}
            disabled={!anyPrunable}
            onClick={() => void prune(repoId)}
          >
            Prune
          </button>
        </>
      }
    >
      {list.length === 0 && q !== "" && <div className={styles["sectionNote"]}>No matches</div>}
      <div role="list" aria-label="Worktrees">
        {list.map((w) => (
          <WorktreeRow key={w.path} repoId={repoId} w={w} currentPath={currentPath} />
        ))}
      </div>
    </SidebarSection>
  );
}
