import { describe, expect, it } from "vitest";
import type { Worktree } from "../../ipc/worktree";
import { worktreeMarksByOid } from "./worktreeMarks";

function wt(over: Partial<Worktree>): Worktree {
  return {
    path: "/p/wt",
    headOid: "a".repeat(40),
    branch: "feat",
    isMain: false,
    isBare: false,
    isDetached: false,
    locked: false,
    lockReason: null,
    prunable: false,
    pruneReason: null,
    ...over,
  };
}

const WIN = String.raw`C:\work\other`;

describe("worktreeMarksByOid", () => {
  it("groups linked worktrees by head oid with the last path segment as label", () => {
    const m = worktreeMarksByOid(
      [wt({}), wt({ path: WIN, branch: null }), wt({ path: "/p/z", headOid: "b".repeat(40) })],
      "/p/proj",
    );
    expect(m.get("a".repeat(40))).toEqual([
      { path: "/p/wt", label: "wt", branch: "feat" },
      { path: WIN, label: "other", branch: null },
    ]);
    expect(m.get("b".repeat(40))).toHaveLength(1);
  });

  it("skips bare, headless and the own checkout", () => {
    const m = worktreeMarksByOid(
      [
        wt({ path: "/p/bare", isBare: true }),
        wt({ path: "/p/none", headOid: null }),
        wt({ path: "/p/own" }),
      ],
      "/p/own/",
    );
    expect(m.size).toBe(0);
  });

  it("marks the main checkout when viewed from a linked worktree", () => {
    const m = worktreeMarksByOid([wt({ path: "/p/proj", isMain: true })], "/p/own");
    expect(m.get("a".repeat(40))).toHaveLength(1);
  });
});
