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
}

export type TreeNode<T> = TreeDir<T> | TreeFile<T>;

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/** Nest entries by their `/`-separated path. Folders first, then files, each by name. Renames sit at the new path. */
export function buildTree<T extends { path: string }>(entries: T[]): TreeNode<T>[] {
  const root: TreeDir<T> = { kind: "dir", name: "", path: "", children: [] };
  for (const item of entries) {
    const parts = item.path.split("/");
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]!;
      const path = parts.slice(0, i + 1).join("/");
      let next = dir.children.find((c): c is TreeDir<T> => c.kind === "dir" && c.name === name);
      if (next === undefined) {
        next = { kind: "dir", name, path, children: [] };
        dir.children.push(next);
      }
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
