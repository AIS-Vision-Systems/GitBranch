import { useMemo } from "react";
import type { Ref, RepoId } from "../../ipc/types";
import { GitBranch } from "../../lib/icons";
import { useGraphStore } from "../../state/graph";
import { BranchTree } from "./BranchTreeView";
import { buildTree, filterTree } from "./branchTree";
import { useLocalCount } from "./counts";
import { SidebarSection } from "./SidebarSection";
import styles from "./Sidebar.module.css";

export function LocalSection({ repoId, query = "" }: { repoId: RepoId; query?: string }) {
  const refs = useGraphStore((s) => s.byRepo[repoId]?.refs?.refs);
  const filtered = useMemo(() => {
    const local: Ref[] = (refs ?? []).filter((r) => r.kind === "localBranch");
    return filterTree(buildTree(local), query);
  }, [refs, query]);
  const count = useLocalCount(repoId, query);
  return (
    <SidebarSection id="local" icon={<GitBranch size={14} />} title="Local" count={count}>
      {count === 0 ? (
        <div className={styles["sectionNote"]}>
          {query.trim() !== "" ? "No matches" : "No branches"}
        </div>
      ) : (
        <BranchTree repoId={repoId} nodes={filtered.nodes} expand={filtered.expand} />
      )}
    </SidebarSection>
  );
}
