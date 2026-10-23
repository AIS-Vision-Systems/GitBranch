import { describe, expect, it } from "vitest";
import type { Ref, RefKind } from "../../ipc/types";
import {
  buildTree,
  countLeaves,
  filterTree,
  groupByRemote,
  remoteLocalName,
  type BranchNode,
} from "./branchTree";

function ref(name: string, kind: RefKind = "localBranch"): Ref {
  return {
    name,
    fullName: `refs/x/${name}`,
    kind,
    target: "0".repeat(40),
    upstream: null,
    isHead: false,
  };
}
const remote = (name: string): Ref => ref(name, { remoteBranch: { remote: name.split("/")[0]! } });
const names = (nodes: BranchNode[]): string[] => nodes.map((n) => `${n.kind[0]}:${n.name}`);

describe("buildTree", () => {
  it("sorts folders and leaves together, case-insensitively", () => {
    const tree = buildTree([
      ref("zeta"),
      ref("Alpha"),
      ref("feature/x"),
      ref("bugfix/y"),
      ref("beta"),
    ]);
    expect(names(tree)).toEqual(["l:Alpha", "l:beta", "f:bugfix", "f:feature", "l:zeta"]);
  });

  it("interleaves a folder between leaves", () => {
    expect(names(buildTree([ref("phase/1"), ref("main")]))).toEqual(["l:main", "f:phase"]);
    expect(names(buildTree([ref("project"), ref("main"), ref("feature/x"), ref("feat")]))).toEqual([
      "l:feat",
      "f:feature",
      "l:main",
      "l:project",
    ]);
  });

  it("nests folders and sets name/path", () => {
    const tree = buildTree([ref("feature/a/b"), ref("feature/a/c"), ref("feature/d")]);
    expect(tree).toHaveLength(1);
    const feature = tree[0] as Extract<BranchNode, { kind: "folder" }>;
    expect(feature.path).toBe("feature");
    expect(names(feature.children)).toEqual(["f:a", "l:d"]);
    const a = feature.children[0] as Extract<BranchNode, { kind: "folder" }>;
    expect(a.path).toBe("feature/a");
    expect(a.children.map((c) => c.path)).toEqual(["feature/a/b", "feature/a/c"]);
    expect(a.children[0]?.name).toBe("b");
  });

  it("uses the remote-relative path for remote branches", () => {
    const tree = buildTree([remote("origin/feature/x")]);
    expect(tree[0]?.path).toBe("feature");
    expect((tree[0] as Extract<BranchNode, { kind: "folder" }>).children[0]?.path).toBe(
      "feature/x",
    );
  });
});

describe("groupByRemote", () => {
  it("groups, sorts remotes, strips prefix, drops HEAD and non-remote refs", () => {
    const groups = groupByRemote([
      remote("upstream/main"),
      remote("origin/main"),
      remote("origin/HEAD"),
      remote("origin/feature/x"),
      ref("main"),
      ref("v1", { tag: { annotated: false } }),
    ]);
    expect(groups.map((g) => g.remote)).toEqual(["origin", "upstream"]);
    expect(groups[0]?.refs.map(remoteLocalName)).toEqual(["main", "feature/x"]);
    expect(groups[1]?.refs).toHaveLength(1);
  });

  it("remoteLocalName leaves local names alone", () => {
    expect(remoteLocalName(ref("origin/main"))).toBe("origin/main");
  });
});

describe("filterTree", () => {
  const tree = buildTree([ref("main"), ref("feature/a/Login"), ref("feature/b"), ref("fix/z")]);

  it("returns the same nodes for an empty query", () => {
    const r = filterTree(tree, "   ");
    expect(r.nodes).toBe(tree);
    expect(r.expand.size).toBe(0);
  });

  it("keeps matches with ancestors and expands them", () => {
    const r = filterTree(tree, "login");
    expect(countLeaves(r.nodes)).toBe(1);
    expect([...r.expand].sort()).toEqual(["feature", "feature/a"]);
    expect(names(r.nodes)).toEqual(["f:feature"]);
  });

  it("matches on the full path", () => {
    const r = filterTree(tree, "feature/b");
    expect(countLeaves(r.nodes)).toBe(1);
  });

  it("returns nothing when no match", () => {
    const r = filterTree(tree, "nope");
    expect(r.nodes).toEqual([]);
    expect(r.expand.size).toBe(0);
  });
});

describe("countLeaves", () => {
  it("counts leaves recursively", () => {
    expect(countLeaves(buildTree([ref("a"), ref("b/c"), ref("b/d/e")]))).toBe(3);
    expect(countLeaves([])).toBe(0);
  });
});
