import type { RepoId } from "../../ipc/types";
import { WorktreesSection } from "./WorktreesSection";
import styles from "./Sidebar.module.css";

export function Sidebar({ repoId }: { repoId: RepoId }) {
  return (
    <aside className={styles["sidebar"]} aria-label="Sidebar">
      <WorktreesSection repoId={repoId} />
    </aside>
  );
}
