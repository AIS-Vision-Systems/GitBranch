import { describe, expect, it } from "vitest";
import {
  buildTree,
  countStatuses,
  statusOf,
  statusOfEntry,
  summaryText,
  type StatusKey,
  type TreeNode,
} from "./fileTree";
import type { StatusEntry } from "../ipc/types";

const e = (path: string, extra: object = {}) => ({ path, ...extra });
const names = (n: TreeNode<{ path: string }>[]): string[] =>
  n.map((x) => (x.kind === "dir" ? `${x.name}/` : x.name));

describe("buildTree", () => {
  it("keeps root files at the top level", () => {
    expect(names(buildTree([e("b.ts"), e("a.ts")]))).toEqual(["a.ts", "b.ts"]);
  });

  it("nests directories and puts folders before files", () => {
    const tree = buildTree([e("z.ts"), e("src/a/x.ts"), e("src/b.ts"), e("src/a/w.ts")]);
    expect(names(tree)).toEqual(["src/", "z.ts"]);
    const src = tree[0]!;
    if (src.kind !== "dir") throw new Error("dir expected");
    expect(src.path).toBe("src");
    expect(names(src.children)).toEqual(["a/", "b.ts"]);
    const a = src.children[0]!;
    if (a.kind !== "dir") throw new Error("dir expected");
    expect(a.path).toBe("src/a");
    expect(names(a.children)).toEqual(["w.ts", "x.ts"]);
  });

  it("places rename entries at the new path and keeps the item", () => {
    const item = e("new/f.ts", { origPath: "old/f.ts" });
    const tree = buildTree([item]);
    const dir = tree[0]!;
    if (dir.kind !== "dir") throw new Error("dir expected");
    expect(dir.name).toBe("new");
    const f = dir.children[0]!;
    if (f.kind !== "file") throw new Error("file expected");
    expect(f.item).toBe(item);
  });

  it("returns an empty tree for no entries", () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe("folder counts", () => {
  const st = (path: string, status: StatusKey) => ({ path, status });
  it("aggregates statuses up the folders", () => {
    const tree = buildTree(
      [
        st("src/a/x.ts", "added"),
        st("src/a/y.ts", "added"),
        st("src/b.ts", "modified"),
        st("src/c/d/e.ts", "deleted"),
        st("top.ts", "renamed"),
      ],
      (f) => f.status,
    );
    const src = tree[0]!;
    if (src.kind !== "dir") throw new Error("dir expected");
    expect(src.counts).toEqual({ modified: 1, added: 2, deleted: 1, renamed: 0, conflicted: 0 });
    const a = src.children[0]!;
    if (a.kind !== "dir") throw new Error("dir expected");
    expect(a.counts.added).toBe(2);
  });

  it("maps entries and summarises without zeros", () => {
    const entry = (o: Partial<StatusEntry>): StatusEntry => ({
      path: "p",
      origPath: null,
      staged: "unmodified",
      unstaged: "unmodified",
      conflicted: false,
      submodule: false,
      ...o,
    });
    expect(statusOfEntry(entry({ unstaged: "untracked" }))).toBe("added");
    expect(statusOfEntry(entry({ staged: "deleted" }))).toBe("deleted");
    expect(statusOfEntry(entry({ unstaged: "modified" }))).toBe("modified");
    expect(statusOfEntry(entry({ conflicted: true, staged: "unmerged" }))).toBe("conflicted");
    expect(statusOf({ kind: "renamed" })).toBe("renamed");
    const c = countStatuses(
      [{ kind: "modified" }, { kind: "modified" }, { kind: "added" }] as const,
      statusOf,
    );
    expect(summaryText(c)).toBe("2 modified · 1 added");
  });
});
