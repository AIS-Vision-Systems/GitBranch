import { beforeEach, describe, expect, it, vi } from "vitest";
import * as cloneIpc from "../ipc/clone";
import { IpcError } from "../ipc/core";
import { useOpsStore } from "./ops";
import { useProgressStore } from "./progress";
import { useReposStore } from "./repos";
import { useUiStore } from "./ui";

vi.mock("../ipc/clone", () => ({ clone: vi.fn() }));
vi.mock("../ipc/progress", () => ({ cancelOp: vi.fn(), onOpProgress: vi.fn() }));
vi.mock("./remotes", () => ({ useRemotesStore: { getState: () => ({ load: vi.fn() }) } }));

const ARGS = {
  url: "https://github.com/o/r.git",
  dest: "C:\\Data\\r",
  branch: null,
  depth: 1,
  recurseSubmodules: false,
};
const toasts = (): { kind: string; title: string }[] => useUiStore.getState().toasts;
const openPath = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  openPath.mockResolvedValue(true);
  useReposStore.setState({ openPath });
  useOpsStore.setState({ busy: false });
  useProgressStore.setState({ active: null, cancelling: false });
  useUiStore.setState({ toasts: [] });
});

describe("clone action", () => {
  it("shows progress, opens the new repo and toasts", async () => {
    let seen = "";
    vi.mocked(cloneIpc.clone).mockImplementation(() => {
      seen = useProgressStore.getState().active?.title ?? "";
      return Promise.resolve({ path: "C:\\Data\\r" });
    });
    expect(await useOpsStore.getState().clone(ARGS)).toBe("C:\\Data\\r");
    expect(seen).toBe("Cloning r");
    expect(openPath).toHaveBeenCalledWith("C:\\Data\\r");
    expect(toasts().map((t) => t.title)).toEqual(["Cloned r"]);
    expect(useProgressStore.getState().active).toBeNull();
  });

  it("reports a cancel as an info toast and opens nothing", async () => {
    vi.mocked(cloneIpc.clone).mockRejectedValue(
      new IpcError({ code: "git.cancelled", message: "x" }),
    );
    expect(await useOpsStore.getState().clone(ARGS)).toBeNull();
    expect(openPath).not.toHaveBeenCalled();
    expect(toasts()).toEqual([
      expect.objectContaining({ kind: "info", title: "Cloning r cancelled" }),
    ]);
  });

  it("toasts when another operation is busy", async () => {
    useOpsStore.setState({ busy: true });
    expect(await useOpsStore.getState().clone(ARGS)).toBeNull();
    expect(cloneIpc.clone).not.toHaveBeenCalled();
    expect(toasts().map((t) => t.title)).toEqual(["Another operation is running"]);
    useOpsStore.setState({ busy: false });
  });

  it("does not toast Cloned when opening fails", async () => {
    vi.mocked(cloneIpc.clone).mockResolvedValue({ path: "/data/r" });
    openPath.mockResolvedValue(false);
    await useOpsStore.getState().clone(ARGS);
    expect(toasts()).toEqual([]);
  });
});
