import { useMemo } from "react";
import type { Ref, RepoId } from "../../ipc/types";
import type { Remote } from "../../ipc/remote";
import { useGithubStore } from "../../state/github";
import { pullsOf, usePullsStore } from "../../state/pulls";
import { useGraphStore } from "../../state/graph";
import { remotesOf, useRemotesStore } from "../../state/remotes";
import { worktreesOf, useWorktreesStore } from "../../state/worktrees";
import { buildTree, countLeaves, filterTree, groupByRemote, remoteLocalName } from "./branchTree";
import type { BranchNode } from "./branchTree";

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

export interface RemoteModel {
  nodes: BranchNode[];
  expand: Set<string>;
  total: number;
}

/** Remote tree for `q` (already lowercased + trimmed); `total` is the leaf count shown in headers. */
export function buildRemoteModel(
  refs: Ref[] | undefined,
  remotes: Remote[],
  q: string,
): RemoteModel {
  const filtering = q !== "";
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
}

export function filterWorktrees<T extends { branch?: string | null; path: string }>(
  all: T[],
  q: string,
): T[] {
  return q === ""
    ? all
    : all.filter((w) => [w.branch ?? "", w.path].join("\n").toLowerCase().includes(q));
}

export function filterPulls<T extends { number: number; title: string }>(all: T[], q: string): T[] {
  return q === "" ? all : all.filter((p) => `#${p.number} ${p.title}`.toLowerCase().includes(q));
}

// Section header counts, shared by the sections and the collapsed rail so they cannot drift.

export function useLocalCount(repoId: RepoId, query = ""): number {
  const refs = useGraphStore((s) => s.byRepo[repoId]?.refs?.refs);
  return useMemo(() => {
    const local: Ref[] = (refs ?? []).filter((r) => r.kind === "localBranch");
    return countLeaves(filterTree(buildTree(local), query).nodes);
  }, [refs, query]);
}

export function useRemoteCount(repoId: RepoId, query = ""): number {
  const refs = useGraphStore((s) => s.byRepo[repoId]?.refs?.refs);
  const remotes = useRemotesStore((s) => remotesOf(s, repoId));
  const q = query.trim().toLowerCase();
  return useMemo(() => buildRemoteModel(refs, remotes, q).total, [refs, remotes, q]);
}

export function useWorktreeCount(repoId: RepoId, query = ""): number {
  const all = useWorktreesStore((s) => worktreesOf(s, repoId));
  return filterWorktrees(all, query.trim().toLowerCase()).length;
}

/** `null` while signed out (no count to show). */
export function usePullCount(repoId: RepoId, query = ""): number | null {
  const signedIn = useGithubStore((s) => s.account !== null && s.account !== undefined);
  const all = usePullsStore((s) => pullsOf(s, repoId).pulls);
  return signedIn ? filterPulls(all, query.trim().toLowerCase()).length : null;
}
