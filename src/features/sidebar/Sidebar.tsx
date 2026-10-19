import type { RepoId } from "../../ipc/types";
import { PullsSection } from "./PullsSection";
import { WorktreesSection } from "./WorktreesSection";
import styles from "./Sidebar.module.css";

export function Sidebar({ repoId }: { repoId: RepoId }) {
  return (
    <aside className={styles["sidebar"]} aria-label="Sidebar">
      <WorktreesSection repoId={repoId} />
      <PullsSection repoId={repoId} />
    </aside>
  );
}
