import { describe, expect, it } from "vitest";
import { buildTree, type TreeNode } from "./fileTree";

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
