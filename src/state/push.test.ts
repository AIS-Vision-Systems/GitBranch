import { beforeEach, describe, expect, it, vi } from "vitest";
import { IpcError } from "../ipc/core";
import type { RepoId, Refs } from "../ipc/types";

vi.mock("../ipc/remote", () => ({
  push: vi.fn(),
  listRemotes: vi.fn(),
}));
vi.mock("../ipc/commit", () => ({
  commit: vi.fn(),
  commitTemplate: vi.fn(),
  headMessage: vi.fn(),
}));

import * as commitIpc from "../ipc/commit";
import * as remoteIpc from "../ipc/remote";
import { useCommitFormStore } from "./commitForm";
import { EMPTY_GRAPH, useGraphStore } from "./graph";
import { AUTH_REQUIRED_TITLE, useOpsStore } from "./ops";
import { useRemotesStore } from "./remotes";
import { useUiStore } from "./ui";

const id = "r1" as RepoId;
const push = vi.mocked(remoteIpc.push);
const toasts = (): { kind: string; title: string }[] => useUiStore.getState().toasts;
const args: remoteIpc.PushArgs = {
  remote: "origin",
  branch: "feat",
  remoteBranch: null,
  setUpstream: false,
  tags: false,
  forceWithLease: false,
};
const OID = "a".repeat(40);

function setRefs(upstream: string | null): void {
  const refs: Refs = {
    head: { oid: OID, branch: "feat", detached: false },
    refs: [
      {
        name: "feat",
        fullName: "refs/heads/feat",
        kind: "localBranch",
        target: OID,
        upstream: upstream === null ? null : { name: upstream, ahead: 1, behind: 0, gone: false },
        isHead: true,
      },
    ],
  };
  useGraphStore.setState({ byRepo: { [id]: { ...EMPTY_GRAPH, refs } } });
}

beforeEach(() => {
  vi.resetAllMocks();
  useOpsStore.setState({ busy: false });
  useUiStore.setState({ toasts: [] });
  useCommitFormStore.getState().reset();
  useGraphStore.setState({ byRepo: {} });
  useRemotesStore.setState({ byRepo: {} });
});

describe("ops.push", () => {
  it("toasts success", async () => {
    push.mockResolvedValue({
      refs: [{ flag: " ", from: "refs/heads/feat", to: "refs/heads/feat", summary: "" }],
    });
    expect(await useOpsStore.getState().push(id, args)).toBe(true);
    expect(toasts()[0]).toMatchObject({ kind: "success", title: "Pushed" });
  });

  it("toasts a rejected push", async () => {
    push.mockRejectedValue(new IpcError({ code: "git.rejected", message: "non-fast-forward" }));
    expect(await useOpsStore.getState().push(id, args)).toBe(false);
    expect(toasts()[0]).toMatchObject({ kind: "error", title: "Push rejected" });
  });

  it("toasts the auth-required explanation", async () => {
    push.mockRejectedValue(new IpcError({ code: "git.auth_required", message: "auth" }));
    expect(await useOpsStore.getState().push(id, args)).toBe(false);
    expect(toasts()[0]).toMatchObject({ kind: "error", title: AUTH_REQUIRED_TITLE });
  });

  it("does nothing while busy", async () => {
    useOpsStore.setState({ busy: true });
    expect(await useOpsStore.getState().push(id, args)).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("commitAndPush", () => {
  const prime = (): void => {
    vi.mocked(commitIpc.commit).mockResolvedValue("abc1234def");
    useCommitFormStore.getState().setMessage(id, "msg");
  };

  it("pushes to the upstream's branch name", async () => {
    prime();
    setRefs("origin/feature-x");
    useRemotesStore.setState({
      byRepo: { [id]: [{ name: "origin", fetchUrl: "u", pushUrl: null }] },
    });
    push.mockResolvedValue({ refs: [] });
    expect(await useCommitFormStore.getState().commitAndPush(id)).toBe(true);
    expect(push).toHaveBeenCalledWith(
      id,
      {
        remote: "origin",
        branch: "feat",
        remoteBranch: "feature-x",
        setUpstream: false,
        tags: false,
        forceWithLease: false,
      },
      expect.any(String),
    );
  });

  it("reports a skipped push when there are no remotes", async () => {
    prime();
    setRefs(null);
    expect(await useCommitFormStore.getState().commitAndPush(id)).toBe(false);
    expect(push).not.toHaveBeenCalled();
    expect(toasts().map((t) => t.title)).toContain("Committed abc1234, not pushed: no remotes");
  });

  it("refuses to commit while another operation runs", async () => {
    prime();
    useOpsStore.setState({ busy: true });
    expect(await useCommitFormStore.getState().commitAndPush(id)).toBe(false);
    expect(commitIpc.commit).not.toHaveBeenCalled();
    expect(toasts()[0]).toMatchObject({ kind: "error", title: "Another operation is running" });
  });
});
