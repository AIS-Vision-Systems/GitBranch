import { describe, expect, it } from "vitest";
import type { Remote } from "../ipc/remote";
import type { Refs } from "../ipc/types";
import { pushDefaults, pushSummary, upstreamBranch, upstreamRemote } from "./pushTarget";

const remotes: Remote[] = [
  { name: "origin", fetchUrl: "a", pushUrl: null },
  { name: "team/fork", fetchUrl: "b", pushUrl: null },
];

describe("pushSummary", () => {
  it("formats refs", () => {
    expect(
      pushSummary(
        [{ flag: " ", from: "refs/heads/main", to: "refs/heads/main", summary: "" }],
        "origin",
      ),
    ).toBe("main → origin/main");
  });
  it("marks up-to-date, deletes and truncates", () => {
    const r = (flag: string, from: string, to: string) => ({ flag, from, to, summary: "" });
    expect(pushSummary([r("=", "refs/heads/a", "refs/heads/a")], "o")).toBe("a → o/a (up to date)");
    expect(pushSummary([r("-", "", "refs/heads/a")], "o")).toBe("(delete) → o/a");
    const many = ["a", "b", "c", "d", "e"].map((n) => r(" ", n, n));
    expect(pushSummary(many, "o")).toBe("a → o/a, b → o/b, c → o/c +2 more");
  });
});

describe("upstream helpers", () => {
  it("resolves remote and branch, longest remote name first", () => {
    expect(upstreamRemote("team/fork/x/y", remotes)).toBe("team/fork");
    expect(upstreamBranch("origin/feat/a", remotes)).toBe("feat/a");
    expect(upstreamRemote(null, remotes)).toBeNull();
    expect(upstreamRemote("zzz/x", remotes)).toBeNull();
  });
  it("pushDefaults without refs prefers origin and sets upstream", () => {
    expect(pushDefaults(null, [])).toBeNull();
    expect(pushDefaults(null, [...remotes].reverse())?.remote).toBe("origin");
  });
});

const refsWith = (upstream: { name: string; gone: boolean } | null): Refs => ({
  head: { oid: "a".repeat(40), branch: "feat", detached: false },
  refs: [
    {
      name: "feat",
      fullName: "refs/heads/feat",
      kind: "localBranch",
      target: "a".repeat(40),
      upstream: upstream === null ? null : { ...upstream, ahead: 0, behind: 0 },
      isHead: true,
    },
  ],
});

describe("pushDefaults remote branch", () => {
  it("uses the upstream's branch name", () => {
    expect(
      pushDefaults(refsWith({ name: "origin/feature-x", gone: false }), remotes),
    ).toMatchObject({
      remote: "origin",
      branch: "feat",
      remoteBranch: "feature-x",
      setUpstream: false,
    });
  });
  it("has no remote branch and sets the upstream without one", () => {
    expect(pushDefaults(refsWith(null), remotes)).toMatchObject({
      remote: "origin",
      branch: "feat",
      remoteBranch: null,
      setUpstream: true,
    });
  });
});
