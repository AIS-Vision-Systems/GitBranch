import { beforeEach, describe, expect, it, vi } from "vitest";
import { IpcError } from "../ipc/core";
import * as remote from "../ipc/remote";
import type { RepoId } from "../ipc/types";
import { useOpsStore } from "./ops";
import { useProgressStore } from "./progress";
import { useUiStore } from "./ui";

vi.mock("../ipc/remote", () => ({ fetch: vi.fn(), pull: vi.fn(), push: vi.fn() }));
vi.mock("../ipc/progress", () => ({ cancelOp: vi.fn(), onOpProgress: vi.fn() }));
vi.mock("./remotes", () => ({ useRemotesStore: { getState: () => ({ load: vi.fn() }) } }));

const id = "r1" as RepoId;
const FETCH = { remote: "origin", prune: false, tags: false };
const toasts = (): { kind: string; title: string }[] => useUiStore.getState().toasts;

beforeEach(() => {
  vi.resetAllMocks();
  useOpsStore.setState({ busy: false });
  useProgressStore.setState({ active: null, cancelling: false });
  useUiStore.setState({ toasts: [] });
});

describe("network ops progress", () => {
  it("fetch passes an opId, shows progress, and finishes on success", async () => {
    const seen: { opId: string; title: string }[] = [];
    vi.mocked(remote.fetch).mockImplementation(() => {
      const a = useProgressStore.getState().active;
      if (a !== null) seen.push({ opId: a.opId, title: a.title });
      return Promise.resolve();
    });
    expect(await useOpsStore.getState().fetch(id, FETCH)).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.title).toBe("Fetching origin");
    expect(vi.mocked(remote.fetch).mock.calls[0]?.[2]).toBe(seen[0]?.opId);
    expect(useProgressStore.getState().active).toBeNull();
  });

  it("finishes the progress on error", async () => {
    vi.mocked(remote.pull).mockRejectedValue(new IpcError({ code: "git.failed", message: "x" }));
    const ok = await useOpsStore
      .getState()
      .pull(id, { remote: null, branch: null, mode: "config" });
    expect(ok).toBe(false);
    expect(useProgressStore.getState().active).toBeNull();
  });

  it("git.cancelled gives an info toast and returns false", async () => {
    vi.mocked(remote.fetch).mockRejectedValue(
      new IpcError({ code: "git.cancelled", message: "cancelled" }),
    );
    expect(await useOpsStore.getState().fetch(id, { ...FETCH, remote: null })).toBe(false);
    expect(toasts()).toEqual([
      expect.objectContaining({ kind: "info", title: "Fetching all remotes cancelled" }),
    ]);
    expect(useProgressStore.getState().active).toBeNull();
  });
});
