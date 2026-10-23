import { useState } from "react";
import type { KeyboardEvent } from "react";
import type { RepoId } from "../../ipc/types";
import { Search } from "../../lib/icons";
import { LocalSection } from "./LocalSection";
import { PullsSection } from "./PullsSection";
import { RemoteSection } from "./RemoteSection";
import { WorktreesSection } from "./WorktreesSection";
import styles from "./Sidebar.module.css";

export function Sidebar({ repoId }: { repoId: RepoId }) {
  const [query, setQuery] = useState("");
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Escape" && query !== "") {
      e.preventDefault();
      setQuery("");
    }
  };
  return (
    <aside className={styles["sidebar"]} aria-label="Sidebar">
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
