import type { ChangeKind } from "../ipc/commit";
import type { FileState, StatusEntry } from "../ipc/types";

export type StatusKey = "modified" | "added" | "deleted" | "renamed" | "conflicted";
export type StatusCounts = Record<StatusKey, number>;

export const emptyCounts = (): StatusCounts => ({
  modified: 0,
  added: 0,
  deleted: 0,
  renamed: 0,
  conflicted: 0,
});

function ofState(s: FileState): StatusKey {
  switch (s) {
    case "added":
    case "copied":
    case "untracked":
      return "added";
    case "deleted":
      return "deleted";
    case "renamed":
      return "renamed";
    case "unmerged":
      return "conflicted";
    case "modified":
    case "typeChanged":
    case "unmodified":
    case "ignored":
      return "modified";
  }
}

/** Status bucket of a working-tree status entry (staged state wins, then unstaged). */
export function statusOfEntry(e: StatusEntry): StatusKey {
  if (e.conflicted) return "conflicted";
  return ofState(e.staged !== "unmodified" ? e.staged : e.unstaged);
}

/** Status bucket of a commit file entry or a file-list item. */
export function statusOf(f: {
  kind: ChangeKind;
  conflicted?: boolean;
  target?: { kind: string };
}): StatusKey {
  if (f.conflicted === true || f.kind === "unmerged") return "conflicted";
  if (f.target?.kind === "untracked") return "added";
  return ofState(f.kind === "unknown" || f.kind === "typeChanged" ? "modified" : f.kind);
}

export function countStatuses<T>(items: T[], status: (t: T) => StatusKey): StatusCounts {
  const c = emptyCounts();
  for (const i of items) c[status(i)]++;
  return c;
}

/** "44 modified · 40 added · 2 deleted", zeros omitted. */
export function summaryText(c: StatusCounts): string {
  const order: StatusKey[] = ["modified", "added", "deleted", "renamed", "conflicted"];
  return order
    .filter((k) => c[k] > 0)
    .map((k) => `${c[k]} ${k}`)
    .join(" · ");
}

export interface TreeFile<T> {
  kind: "file";
  name: string;
  path: string;
  item: T;
}

export interface TreeDir<T> {
  kind: "dir";
  name: string;
  /** Full directory path without trailing slash; unique per tree. */
  path: string;
  children: TreeNode<T>[];
  /** Status counts of every file below this folder. */
  counts: StatusCounts;
}

export type TreeNode<T> = TreeDir<T> | TreeFile<T>;

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/** Nest entries by their `/`-separated path. Folders first, then files, each by name. Renames sit at the new path. */
export function buildTree<T extends { path: string }>(
  entries: T[],
  status: (t: T) => StatusKey = () => "modified",
): TreeNode<T>[] {
  const root: TreeDir<T> = { kind: "dir", name: "", path: "", children: [], counts: emptyCounts() };
  for (const item of entries) {
    const parts = item.path.split("/");
    const st = status(item);
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]!;
      const path = parts.slice(0, i + 1).join("/");
      let next = dir.children.find((c): c is TreeDir<T> => c.kind === "dir" && c.name === name);
      if (next === undefined) {
        next = { kind: "dir", name, path, children: [], counts: emptyCounts() };
        dir.children.push(next);
      }
      next.counts[st]++;
      dir = next;
    }
    dir.children.push({ kind: "file", name: parts[parts.length - 1]!, path: item.path, item });
  }
  const sort = (d: TreeDir<T>): void => {
    const dirs = d.children.filter((c): c is TreeDir<T> => c.kind === "dir").sort(byName);
    const files = d.children.filter((c): c is TreeFile<T> => c.kind === "file").sort(byName);
    d.children = [...dirs, ...files];
    dirs.forEach(sort);
  };
  sort(root);
  return root.children;
}

/** Paths of every folder in the tree. */
export function dirPaths<T>(nodes: TreeNode<T>[]): string[] {
  const out: string[] = [];
  const walk = (ns: TreeNode<T>[]): void => {
    for (const n of ns) {
      if (n.kind === "dir") {
        out.push(n.path);
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return out;
}
