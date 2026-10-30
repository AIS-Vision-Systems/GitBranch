import { beforeEach, describe, expect, it, vi } from "vitest";
import * as initIpc from "../ipc/init";
import { useOpsStore } from "./ops";
import { useReposStore } from "./repos";
import { useUiStore } from "./ui";

vi.mock("../ipc/init", () => ({ initRepo: vi.fn() }));
vi.mock("../ipc/progress", () => ({ cancelOp: vi.fn(), onOpProgress: vi.fn() }));
vi.mock("./remotes", () => ({ useRemotesStore: { getState: () => ({ load: vi.fn() }) } }));

const ARGS = { dest: "/data/r", initialBranch: "main", readme: true };
const toasts = (): { kind: string; title: string; detail?: string }[] =>
  useUiStore.getState().toasts;
const openPath = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  openPath.mockResolvedValue(true);
  useReposStore.setState({ openPath });
  useOpsStore.setState({ busy: false });
  useUiStore.setState({ toasts: [] });
});

describe("initRepo action", () => {
  it("opens the new repo and toasts", async () => {
    vi.mocked(initIpc.initRepo).mockResolvedValue({ path: "/data/r", commitError: null });
    expect(await useOpsStore.getState().initRepo(ARGS)).toBe("/data/r");
    expect(initIpc.initRepo).toHaveBeenCalledWith(ARGS);
    expect(openPath).toHaveBeenCalledWith("/data/r");
    expect(toasts().map((t) => t.title)).toEqual(["Created r"]);
  });

  it("warns when the initial commit failed but keeps the repo", async () => {
    vi.mocked(initIpc.initRepo).mockResolvedValue({ path: "/data/r", commitError: "no identity" });
    expect(await useOpsStore.getState().initRepo(ARGS)).toBe("/data/r");
    expect(openPath).toHaveBeenCalledWith("/data/r");
    const t = toasts();
    expect(t.map((x) => x.title)).toEqual([
      "Created r",
      "Repository created, but the initial commit failed",
    ]);
    expect(t[1]?.kind).toBe("error");
    expect(t[1]?.detail).toContain("no identity");
  });

  it("reports a failure and opens nothing", async () => {
    vi.mocked(initIpc.initRepo).mockRejectedValue(new Error("boom"));
    expect(await useOpsStore.getState().initRepo(ARGS)).toBeNull();
    expect(openPath).not.toHaveBeenCalled();
    expect(toasts()[0]?.title).toBe("Create repository failed");
  });
});
