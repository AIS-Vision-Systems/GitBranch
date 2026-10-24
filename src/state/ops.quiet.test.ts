import { beforeEach, describe, expect, it, vi } from "vitest";
import { IpcError } from "../ipc/core";
import * as progress from "../ipc/progress";
import * as remote from "../ipc/remote";
import type { RepoId } from "../ipc/types";
import { quietFetchDue, resetQuietFetchThrottle, useOpsStore } from "./ops";
import { useProgressStore } from "./progress";
import { useRemotesStore } from "./remotes";
import { useUiStore } from "./ui";

vi.mock("../ipc/remote", () => ({
  fetch: vi.fn(),
  pull: vi.fn(),
  push: vi.fn(),
  listRemotes: vi.fn(),
}));
vi.mock("../ipc/progress", () => ({ cancelOp: vi.fn(), onOpProgress: vi.fn() }));

const id = "r1" as RepoId;
const origin = { name: "origin", fetchUrl: "u", pushUrl: null };

beforeEach(() => {
  vi.resetAllMocks();
  resetQuietFetchThrottle();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  useOpsStore.setState({ busy: false });
  useProgressStore.setState({ active: null, cancelling: false });
  useUiStore.setState({ toasts: [] });
  useRemotesStore.setState({ byRepo: { [id]: [origin] } });
});

describe("fetchQuiet", () => {
  it("fetches all remotes with prune, no toast, then throttles", async () => {
    vi.mocked(remote.fetch).mockResolvedValue(undefined);
    expect(await useOpsStore.getState().fetchQuiet(id)).toBe(true);
    expect(vi.mocked(remote.fetch).mock.calls[0]?.[1]).toEqual({
      remote: null,
      prune: true,
      tags: false,
    });
    expect(useUiStore.getState().toasts).toHaveLength(0);
    expect(await useOpsStore.getState().fetchQuiet(id)).toBe(false);
    expect(remote.fetch).toHaveBeenCalledTimes(1);
    expect(quietFetchDue(id, Date.now() + 61_000)).toBe(true);
  });

  it("swallows errors without a toast", async () => {
    vi.mocked(remote.fetch).mockRejectedValue(new Error("offline"));
    expect(await useOpsStore.getState().fetchQuiet(id)).toBe(false);
    expect(useUiStore.getState().toasts).toHaveLength(0);
    expect(console.warn).toHaveBeenCalled();
    expect(useOpsStore.getState().busy).toBe(false);
  });

  it("never sets the store-wide busy flag", async () => {
    let release: () => void = () => undefined;
    vi.mocked(remote.fetch).mockReturnValue(new Promise<void>((r) => (release = r)));
    const p = useOpsStore.getState().fetchQuiet(id);
    expect(useOpsStore.getState().busy).toBe(false);
    expect(useProgressStore.getState().active?.repoId).toBe(id);
    release();
    expect(await p).toBe(true);
    expect(useOpsStore.getState().busy).toBe(false);
    expect(useProgressStore.getState().active).toBeNull();
  });

  it("a user operation cancels a running quiet fetch, silently, and then proceeds", async () => {
    let reject: (e: unknown) => void = () => undefined;
    vi.mocked(remote.fetch).mockImplementationOnce(
      () => new Promise<void>((_res, rej) => (reject = rej)),
    );
    vi.mocked(progress.cancelOp).mockImplementation(() => {
      reject(new IpcError({ code: "git.cancelled", message: "cancelled" }));
      return Promise.resolve(true);
    });
    vi.mocked(remote.pull).mockResolvedValue({ changed: true });
    const quiet = useOpsStore.getState().fetchQuiet(id);
    const quietOpId = useProgressStore.getState().active?.opId;
    const pulled = await useOpsStore
      .getState()
      .pull(id, { remote: "origin", branch: "main", mode: "config" });
    expect(progress.cancelOp).toHaveBeenCalledWith(quietOpId);
    expect(await quiet).toBe(false);
    expect(pulled).toBe(true);
    expect(remote.pull).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();
    expect(useOpsStore.getState().busy).toBe(false);
    expect(useUiStore.getState().toasts.some((t) => t.kind === "error")).toBe(false);
  });

  it("skips silently when busy or without remotes", async () => {
    useOpsStore.setState({ busy: true });
    expect(await useOpsStore.getState().fetchQuiet(id)).toBe(false);
    useOpsStore.setState({ busy: false });
    useRemotesStore.setState({ byRepo: { [id]: [] } });
    expect(await useOpsStore.getState().fetchQuiet(id)).toBe(false);
    expect(remote.fetch).not.toHaveBeenCalled();
    expect(useUiStore.getState().toasts).toHaveLength(0);
  });
});
