import { beforeEach, describe, expect, it, vi } from "vitest";
import * as branch from "../ipc/branch";
import * as remote from "../ipc/remote";
import type { Ref, RepoId } from "../ipc/types";
import { EMPTY_GRAPH, useGraphStore } from "./graph";
import { useOpsStore } from "./ops";
import { useProgressStore } from "./progress";
import { useUiStore } from "./ui";

vi.mock("../ipc/branch", () => ({ checkout: vi.fn() }));
vi.mock("../ipc/remote", () => ({ fetch: vi.fn(), pull: vi.fn(), push: vi.fn() }));
vi.mock("../ipc/progress", () => ({ cancelOp: vi.fn(), onOpProgress: vi.fn() }));

const id = "r1" as RepoId;
const rb: Ref = {
  name: "origin/feat",
  fullName: "refs/remotes/origin/feat",
  kind: { remoteBranch: { remote: "origin" } },
  target: "o1",
  upstream: null,
  isHead: false,
};
const local = (name: string, upstream: Ref["upstream"] = null): Ref => ({
  name,
  fullName: `refs/heads/${name}`,
  kind: "localBranch",
  target: "o0",
  upstream,
  isHead: false,
});

function seed(refs: Ref[]): void {
  useGraphStore.setState({
    byRepo: {
      [id]: { ...EMPTY_GRAPH, refs: { head: { oid: null, branch: null, detached: false }, refs } },
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  useOpsStore.setState({ busy: false });
  useProgressStore.setState({ active: null, cancelling: false });
  useUiStore.setState({ toasts: [] });
  vi.mocked(branch.checkout).mockResolvedValue(undefined);
  vi.mocked(remote.pull).mockResolvedValue({ changed: true });
});

describe("checkout of a remote branch", () => {
  it("pulls when the local branch already exists", async () => {
    seed([rb, local("feat")]);
    expect(await useOpsStore.getState().checkout(id, "origin/feat")).toBe(true);
    expect(vi.mocked(remote.pull).mock.calls[0]?.[1]).toEqual({
      remote: "origin",
      branch: "feat",
      mode: "config",
    });
  });

  it("pulls when the local branch is behind its upstream", async () => {
    seed([rb, local("feat", { name: "origin/feat", ahead: 0, behind: 2, gone: false })]);
    await useOpsStore.getState().checkout(id, "origin/feat");
    expect(remote.pull).toHaveBeenCalledTimes(1);
  });

  it("skips the pull and toasts when the local branch is ahead of its upstream", async () => {
    seed([rb, local("feat", { name: "origin/feat", ahead: 1, behind: 2, gone: false })]);
    expect(await useOpsStore.getState().checkout(id, "origin/feat")).toBe(true);
    expect(remote.pull).not.toHaveBeenCalled();
    expect(useUiStore.getState().toasts[0]).toMatchObject({
      kind: "info",
      title: "feat has local commits",
      detail: "Pull it from the ribbon when ready.",
    });
  });

  it("does not pull when the local branch is missing, detached, or a plain branch", async () => {
    seed([rb]);
    await useOpsStore.getState().checkout(id, "origin/feat");
    seed([rb, local("feat")]);
    await useOpsStore.getState().checkout(id, "origin/feat", true);
    await useOpsStore.getState().checkout(id, "feat");
    expect(remote.pull).not.toHaveBeenCalled();
  });
});
