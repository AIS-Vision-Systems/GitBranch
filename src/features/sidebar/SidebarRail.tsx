import type { ReactNode } from "react";
import type { RepoId } from "../../ipc/types";
import { ChevronsRight, Cloud, FolderGit2, GitBranch, GitPullRequest } from "../../lib/icons";
import { pullsOf, usePullsStore } from "../../state/pulls";
import { useUiStore } from "../../state/ui";
import { useLocalCount, usePullCount, useRemoteCount, useWorktreeCount } from "./counts";
import styles from "./Sidebar.module.css";

interface RailItemProps {
  id: string;
  title: string;
  icon: ReactNode;
  count: number | null;
}

function RailItem({ id, title, icon, count }: RailItemProps) {
  const setSection = useUiStore((s) => s.setSidebarSection);
  const setOpen = useUiStore((s) => s.setSidebarOpen);
  const requestScroll = useUiStore((s) => s.requestSidebarScroll);
  const label = count === null ? title : `${title} (${count})`;
  const onClick = (): void => {
    setSection(id, true);
    setOpen(true);
    requestScroll(id);
  };
  return (
    <button
      type="button"
      className={styles["railButton"]}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {icon}
      {count !== null && (
        <span className={styles["railBadge"]} aria-hidden="true">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}

/** 36 px icon rail shown while the sidebar is collapsed. */
export function SidebarRail({ repoId }: { repoId: RepoId }) {
  const setOpen = useUiStore((s) => s.setSidebarOpen);
  const local = useLocalCount(repoId);
  const remote = useRemoteCount(repoId);
  const worktrees = useWorktreeCount(repoId);
  const pulls = usePullCount(repoId);
  // The pull-request section only exists for repositories with a GitHub remote.
  const hasPulls = usePullsStore((s) => {
    const slug = pullsOf(s, repoId).slug;
    return slug !== null && slug !== undefined;
  });
  return (
    <nav className={styles["rail"]} aria-label="Sidebar (collapsed)">
      <button
        type="button"
        className={styles["railButton"]}
        aria-label="Expand sidebar"
        title="Expand sidebar (Ctrl+B)"
        onClick={() => setOpen(true)}
      >
        <ChevronsRight size={16} aria-hidden />
      </button>
      <RailItem id="local" title="Local" icon={<GitBranch size={16} aria-hidden />} count={local} />
      <RailItem id="remote" title="Remote" icon={<Cloud size={16} aria-hidden />} count={remote} />
      <RailItem
        id="worktrees"
        title="Worktrees"
        icon={<FolderGit2 size={16} aria-hidden />}
        count={worktrees}
      />
      {hasPulls && (
        <RailItem
          id="pulls"
          title="Pull requests"
          icon={<GitPullRequest size={16} aria-hidden />}
          count={pulls}
        />
      )}
    </nav>
  );
}
