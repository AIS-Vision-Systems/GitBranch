import { useMemo } from "react";
import type { RepoId } from "../../ipc/types";
import { Cloud, Plus } from "../../lib/icons";
import { useGraphStore } from "../../state/graph";
import { remotesOf, useRemotesStore } from "../../state/remotes";
import { openRemotes } from "../dialogs/open";
import { BranchTree } from "./BranchTreeView";
import { buildRemoteModel, useRemoteCount } from "./counts";
import { SidebarSection } from "./SidebarSection";
import styles from "./Sidebar.module.css";

export function RemoteSection({ repoId, query = "" }: { repoId: RepoId; query?: string }) {
  const refs = useGraphStore((s) => s.byRepo[repoId]?.refs?.refs);
  const remotes = useRemotesStore((s) => remotesOf(s, repoId));
  const count = useRemoteCount(repoId, query);
  const q = query.trim().toLowerCase();
  const filtering = q !== "";

  const { nodes, expand } = useMemo(() => buildRemoteModel(refs, remotes, q), [refs, remotes, q]);

  return (
    <SidebarSection
      id="remote"
      icon={<Cloud size={14} />}
      title="Remote"
      count={count}
      actions={
        <button
          type="button"
          className={styles["headerAction"]}
          aria-label="Add remote…"
          title="Add remote…"
          onClick={() => openRemotes(repoId)}
        >
          <Plus size={14} aria-hidden />
        </button>
      }
    >
      {nodes.length === 0 ? (
        <div className={styles["sectionNote"]}>{filtering ? "No matches" : "No remotes"}</div>
      ) : (
        <BranchTree repoId={repoId} nodes={nodes} expand={expand} />
      )}
    </SidebarSection>
  );
}
