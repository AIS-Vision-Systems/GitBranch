import { describe, expect, it } from "vitest";
import type { Ref } from "../../ipc/types";
import { chipItems } from "./chips";

const local = (name: string, over: Partial<Ref> = {}): Ref => ({
  name,
  fullName: `refs/heads/${name}`,
  kind: "localBranch",
  target: "c0",
  upstream: null,
  isHead: false,
  ...over,
});
const remote = (name: string): Ref => ({
  name,
  fullName: `refs/remotes/${name}`,
  kind: { remoteBranch: { remote: name.split("/")[0]! } },
  target: "c0",
  upstream: null,
  isHead: false,
});
const up = { name: "origin/main", ahead: 0, behind: 0, gone: false };

describe("chipItems", () => {
  it("folds the upstream remote chip into the local chip and puts HEAD first", () => {
    const items = chipItems([
      remote("origin/main"),
      local("dev"),
      local("main", { isHead: true, upstream: up }),
    ]);
    expect(items.map((i) => i.gitRef.name)).toEqual(["main", "dev"]);
    expect(items[0]!.withUpstream).toBe(true);
    expect(items[0]!.remotes).toEqual(["origin"]);
    expect(items[1]!.remotes).toEqual([]);
  });

  it("folds every remote with the same branch name", () => {
    const items = chipItems([
      remote("fork/main"),
      local("main", { upstream: up }),
      remote("origin/main"),
    ]);
    expect(items.map((i) => i.gitRef.name)).toEqual(["main"]);
    expect(items[0]!.remotes).toEqual(["fork", "origin"]);
  });

  it("keeps a remote chip without a local counterpart", () => {
    const items = chipItems([local("main", { upstream: up }), remote("origin/other")]);
    expect(items.map((i) => i.gitRef.name)).toEqual(["main", "origin/other"]);
    expect(items[1]!.remotes).toEqual([]);
  });

  it("folds a remote even when the upstream is gone, without the upstream flag", () => {
    const items = chipItems([
      local("main", { upstream: { ...up, gone: true } }),
      remote("origin/main"),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.withUpstream).toBe(false);
    expect(items[0]!.remotes).toEqual(["origin"]);
  });
});
