import { useMemo } from "react";
import type { Ref, RepoId } from "../../ipc/types";
import { Cloud, Plus } from "../../lib/icons";
import { useGraphStore } from "../../state/graph";
import { remotesOf, useRemotesStore } from "../../state/remotes";
import { openRemotes } from "../dialogs/open";
import { BranchTree } from "./BranchTreeView";
import { buildTree, countLeaves, groupByRemote, remoteLocalName } from "./branchTree";
import type { BranchNode } from "./branchTree";
import { SidebarSection } from "./SidebarSection";
import styles from "./Sidebar.module.css";

/** Folder/leaf paths are made unique across remotes by prefixing the remote name. */
const scope = (remote: string, path: string): string => `${remote}\u0000${path}`;

function scopeNodes(remote: string, nodes: BranchNode[]): BranchNode[] {
  return nodes.map((n) =>
    n.kind === "leaf"
      ? { ...n, path: scope(remote, n.path) }
      : { ...n, path: scope(remote, n.path), children: scopeNodes(remote, n.children) },
  );
}

function folderPaths(nodes: BranchNode[], out: Set<string>): Set<string> {
  for (const n of nodes) {
    if (n.kind === "folder") {
      out.add(n.path);
      folderPaths(n.children, out);
    }
  }
  return out;
}

/** Refs of one remote that match `q` (already lowercased) by full tracking name or relative path. */
function matching(refs: Ref[], q: string): Ref[] {
  return refs.filter(
    (r) => r.name.toLowerCase().includes(q) || remoteLocalName(r).toLowerCase().includes(q),
  );
}

export function RemoteSection({ repoId, query = "" }: { repoId: RepoId; query?: string }) {
  const refs = useGraphStore((s) => s.byRepo[repoId]?.refs?.refs);
  const remotes = useRemotesStore((s) => remotesOf(s, repoId));
  const q = query.trim().toLowerCase();
  const filtering = q !== "";

  const { nodes, expand, total } = useMemo(() => {
    const groups = new Map<string, Ref[]>();
    for (const g of groupByRemote(refs ?? [])) groups.set(g.remote, g.refs);
    // Remotes without branches yet are listed (hidden while filtering).
    if (!filtering) for (const r of remotes) if (!groups.has(r.name)) groups.set(r.name, []);

    const roots: BranchNode[] = [];
    const forced = new Set<string>();
    let count = 0;
    for (const [remote, list] of groups) {
      const nameHit = remote.toLowerCase().includes(q);
      const picked = !filtering || nameHit ? list : matching(list, q);
      if (filtering && picked.length === 0) continue;
      const children = scopeNodes(remote, buildTree(picked));
      count += countLeaves(children);
      const path = scope(remote, "");
      roots.push({ kind: "folder", name: remote, path, children });
      if (filtering) {
        forced.add(path);
        // Matches below a non-matching remote name reveal their folders; a name hit just opens it.
        if (!nameHit) folderPaths(children, forced);
      }
    }
    roots.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return { nodes: roots, expand: forced, total: count };
  }, [refs, remotes, q, filtering]);

  return (
    <SidebarSection
      id="remote"
      icon={<Cloud size={14} />}
      title="Remote"
      count={total}
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
