import type { Ref } from "../../ipc/types";

export interface BranchLeaf {
  kind: "leaf";
  /** Last path segment. */
  name: string;
  /** Full name within the tree (relative to the remote for remote branches). */
  path: string;
  ref: Ref;
}
export interface BranchFolder {
  kind: "folder";
  name: string;
  path: string;
  children: BranchNode[];
}
export type BranchNode = BranchLeaf | BranchFolder;

export interface FilteredTree {
  nodes: BranchNode[];
  /** Folder paths that must be expanded because a descendant matches. */
  expand: ReadonlySet<string>;
}

function remoteOf(ref: Ref): string | null {
  return typeof ref.kind === "object" && "remoteBranch" in ref.kind
    ? ref.kind.remoteBranch.remote
    : null;
}

/** Name of a ref relative to its remote (`origin/feature/x` -> `feature/x`); unchanged otherwise. */
export function remoteLocalName(ref: Ref): string {
  const remote = remoteOf(ref);
  if (remote !== null && ref.name.startsWith(`${remote}/`)) {
    return ref.name.slice(remote.length + 1);
  }
  return ref.name;
}

const collator = new Intl.Collator(undefined, { sensitivity: "base" });
const byName = (a: BranchNode, b: BranchNode): number => collator.compare(a.name, b.name);

function sortNodes(nodes: BranchNode[]): BranchNode[] {
  const folders = nodes.filter((n) => n.kind === "folder").sort(byName);
  const leaves = nodes.filter((n) => n.kind === "leaf").sort(byName);
  for (const f of folders) {
    if (f.kind === "folder") f.children = sortNodes(f.children);
  }
  return [...folders, ...leaves];
}

/** Builds a folder tree by `/`; folders first, then leaves, each sorted case-insensitively. */
export function buildTree(refs: Ref[]): BranchNode[] {
  const root: BranchNode[] = [];
  const folders = new Map<string, BranchFolder>();
  for (const ref of refs) {
    const path = remoteLocalName(ref);
    const segments = path.split("/");
    let siblings = root;
    let prefix = "";
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;
      prefix = prefix === "" ? seg : `${prefix}/${seg}`;
      let folder = folders.get(prefix);
      if (!folder) {
        folder = { kind: "folder", name: seg, path: prefix, children: [] };
        folders.set(prefix, folder);
        siblings.push(folder);
      }
      siblings = folder.children;
    }
    siblings.push({ kind: "leaf", name: segments[segments.length - 1]!, path, ref });
  }
  return sortNodes(root);
}

/** Remote-branch refs grouped per remote (sorted case-insensitively); `<remote>/HEAD` is dropped. */
export function groupByRemote(refs: Ref[]): { remote: string; refs: Ref[] }[] {
  const groups = new Map<string, Ref[]>();
  for (const ref of refs) {
    const remote = remoteOf(ref);
    if (remote === null) continue;
    if (remoteLocalName(ref) === "HEAD") continue;
    const list = groups.get(remote);
    if (list) list.push(ref);
    else groups.set(remote, [ref]);
  }
  return [...groups.entries()]
    .map(([remote, list]) => ({ remote, refs: list }))
    .sort((a, b) => collator.compare(a.remote, b.remote));
}

function pruneNodes(nodes: BranchNode[], q: string, expand: Set<string>): BranchNode[] {
  const out: BranchNode[] = [];
  for (const node of nodes) {
    if (node.kind === "leaf") {
      if (node.path.toLowerCase().includes(q)) out.push(node);
    } else {
      const children = pruneNodes(node.children, q, expand);
      if (children.length > 0) {
        expand.add(node.path);
        out.push({ ...node, children });
      }
    }
  }
  return out;
}

/** Case-insensitive filter on the full leaf path; ancestors of matches are kept and auto-expanded. */
export function filterTree(nodes: BranchNode[], query: string): FilteredTree {
  const q = query.trim().toLowerCase();
  if (q === "") return { nodes, expand: new Set() };
  const expand = new Set<string>();
  return { nodes: pruneNodes(nodes, q, expand), expand };
}

export function countLeaves(nodes: BranchNode[]): number {
  let n = 0;
  for (const node of nodes) n += node.kind === "leaf" ? 1 : countLeaves(node.children);
  return n;
}
