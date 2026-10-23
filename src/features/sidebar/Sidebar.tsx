import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import type { RepoId } from "../../ipc/types";
import { ChevronsLeft, Search } from "../../lib/icons";
import { useUiStore } from "../../state/ui";
import { LocalSection } from "./LocalSection";
import { PullsSection } from "./PullsSection";
import { RemoteSection } from "./RemoteSection";
import { SidebarRail } from "./SidebarRail";
import { WorktreesSection } from "./WorktreesSection";
import styles from "./Sidebar.module.css";

export function Sidebar({ repoId, width }: { repoId: RepoId; width?: number }) {
  const [query, setQuery] = useState("");
  const open = useUiStore((s) => s.sidebarOpen);
  const setOpen = useUiStore((s) => s.setSidebarOpen);
  const pending = useUiStore((s) => s.pendingSidebarScroll);
  const clearScroll = useUiStore((s) => s.clearSidebarScroll);
  useEffect(() => {
    if (!open || pending === null) return;
    document.querySelector(`[data-section="${pending}"]`)?.scrollIntoView({ block: "start" });
    clearScroll();
  }, [open, pending, clearScroll]);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Escape" && query !== "") {
      e.preventDefault();
      setQuery("");
    }
  };
  if (!open) return <SidebarRail repoId={repoId} />;
  return (
    <aside
      className={styles["sidebar"]}
      aria-label="Sidebar"
      {...(width !== undefined ? { style: { width } } : {})}
    >
      <div className={styles["filterBox"]}>
        <Search size={14} aria-hidden className={styles["filterIcon"]} />
        <input
          type="search"
          className={styles["filterInput"]}
          placeholder="Filter"
          aria-label="Filter sidebar"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className={styles["collapseButton"]}
          aria-label="Collapse sidebar"
          title="Collapse sidebar (Ctrl+B)"
          onClick={() => setOpen(false)}
        >
          <ChevronsLeft size={16} aria-hidden />
        </button>
      </div>
      <div className={styles["sidebarBody"]}>
        <LocalSection repoId={repoId} query={query} />
        <RemoteSection repoId={repoId} query={query} />
        <WorktreesSection repoId={repoId} query={query} />
        <PullsSection repoId={repoId} query={query} />
      </div>
    </aside>
  );
}
