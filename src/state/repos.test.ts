import { beforeEach, describe, expect, it, vi } from "vitest";
import { IpcError } from "../ipc/core";
import type { OpenedRepo, RepoId } from "../ipc/types";

vi.mock("../ipc/repo", () => ({
  pickRepoDir: vi.fn(),
  openRepo: vi.fn(),
  listRecent: vi.fn(),
  removeRecent: vi.fn(),
  closeRepo: vi.fn(),
}));

import * as ipc from "../ipc/repo";
import { useReposStore } from "./repos";
import { useUiStore } from "./ui";

const m = vi.mocked(ipc);

function repo(over: Partial<OpenedRepo> = {}): OpenedRepo {
  return {
    repoId: "r1" as RepoId,
    name: "proj",
    path: "/p/proj",
    gitDir: "/p/proj/.git",
    isWorktree: false,
    mainWorkTree: null,
    isBare: false,
    ...over,
  };
}

const wt = repo({
  repoId: "w1" as RepoId,
  name: "wt",
  path: "/p/wt",
  isWorktree: true,
  mainWorkTree: "/p/proj",
});

describe("repos store", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useReposStore.setState({ open: [], currentId: null, recent: [], pendingWorktree: null });
    useUiStore.setState({ toasts: [] });
    m.listRecent.mockResolvedValue([{ path: "/p/proj", name: "proj", lastOpened: 1 }]);
  });

  it("openPath adds, selects and refreshes recent", async () => {
    m.openRepo.mockResolvedValue(repo());
    await useReposStore.getState().openPath("/p/proj");
    const s = useReposStore.getState();
    expect(s.open).toHaveLength(1);
    expect(s.currentId).toBe("r1");
    expect(s.recent).toHaveLength(1);
  });

  it("opening an already-open repo just selects it", async () => {
    m.openRepo
      .mockResolvedValueOnce(repo())
      .mockResolvedValueOnce(repo({ repoId: "r2" as RepoId }));
    await useReposStore.getState().openPath("/a");
    await useReposStore.getState().openPath("/b");
    m.openRepo.mockResolvedValueOnce(repo());
    await useReposStore.getState().openPath("/a");
    const s = useReposStore.getState();
    expect(s.open).toHaveLength(2);
    expect(s.currentId).toBe("r1");
  });

  it("a worktree sets pendingWorktree without adding", async () => {
    m.openRepo.mockResolvedValue(wt);
    await useReposStore.getState().openPath("/p/wt");
    const s = useReposStore.getState();
    expect(s.pendingWorktree).toEqual(wt);
    expect(s.open).toHaveLength(0);
    expect(s.currentId).toBeNull();
  });

  it("resolveWorktree main opens the main work tree", async () => {
    useReposStore.setState({ pendingWorktree: wt });
    m.openRepo.mockResolvedValue(repo());
    await useReposStore.getState().resolveWorktree("main");
    expect(m.openRepo).toHaveBeenCalledWith("/p/proj");
    const s = useReposStore.getState();
    expect(s.currentId).toBe("r1");
    expect(s.pendingWorktree).toBeNull();
  });

  it("resolveWorktree worktree selects the pending one", async () => {
    useReposStore.setState({ pendingWorktree: wt });
    await useReposStore.getState().resolveWorktree("worktree");
    expect(m.openRepo).not.toHaveBeenCalled();
    const s = useReposStore.getState();
    expect(s.currentId).toBe("w1");
    expect(s.open).toEqual([wt]);
    expect(s.pendingWorktree).toBeNull();
  });

  it("cancelWorktree clears pendingWorktree", () => {
    useReposStore.setState({ pendingWorktree: wt });
    useReposStore.getState().cancelWorktree();
    expect(useReposStore.getState().pendingWorktree).toBeNull();
  });

  it("not_a_repo shows a dedicated toast", async () => {
    m.openRepo.mockRejectedValue(new IpcError({ code: "git.not_a_repo", message: "nope" }));
    await useReposStore.getState().openPath("/x");
    const toasts = useUiStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.title).toBe("Not a git repository");
    expect(toasts[0]?.detail).toBe("/x");
    expect(useReposStore.getState().currentId).toBeNull();
  });

  it("other errors use the generic title", async () => {
    m.openRepo.mockRejectedValue(new IpcError({ code: "git.other", message: "boom" }));
    await useReposStore.getState().openPath("/x");
    expect(useUiStore.getState().toasts[0]?.title).toBe("Could not open repository");
  });

  it("dialog cancel does nothing", async () => {
    m.pickRepoDir.mockResolvedValue(null);
    await useReposStore.getState().openViaDialog();
    expect(m.openRepo).not.toHaveBeenCalled();
    expect(useUiStore.getState().toasts).toHaveLength(0);
  });

  it("dialog path is opened", async () => {
    m.pickRepoDir.mockResolvedValue("/p/proj");
    m.openRepo.mockResolvedValue(repo());
    await useReposStore.getState().openViaDialog();
    expect(m.openRepo).toHaveBeenCalledWith("/p/proj");
    expect(useReposStore.getState().currentId).toBe("r1");
  });

  it("close resets currentId", async () => {
    m.openRepo.mockResolvedValue(repo());
    m.closeRepo.mockResolvedValue(undefined);
    await useReposStore.getState().openPath("/p/proj");
    await useReposStore.getState().close("r1");
    const s = useReposStore.getState();
    expect(m.closeRepo).toHaveBeenCalledWith("r1");
    expect(s.currentId).toBeNull();
    expect(s.open).toHaveLength(0);
  });

  it("openWorktree selects the worktree without the prompt", async () => {
    m.openRepo.mockResolvedValue(wt);
    await useReposStore.getState().openWorktree("/p/wt");
    const s = useReposStore.getState();
    expect(s.pendingWorktree).toBeNull();
    expect(s.currentId).toBe("w1");
    expect(s.open).toHaveLength(1);
  });

  it("openWorktree only selects when the path is already open", async () => {
    useReposStore.setState({ open: [repo(), wt], currentId: "r1" });
    await useReposStore.getState().openWorktree("/p/wt/");
    expect(m.openRepo).not.toHaveBeenCalled();
    expect(useReposStore.getState().currentId).toBe("w1");
  });

  it("openWorktree reports errors", async () => {
    m.openRepo.mockRejectedValue(new IpcError({ code: "git.other", message: "boom" }));
    await useReposStore.getState().openWorktree("/p/gone");
    expect(useUiStore.getState().toasts).toHaveLength(1);
    expect(useReposStore.getState().open).toHaveLength(0);
  });

  it("select ignores unknown ids and nextTab cycles in display order", () => {
    const other = repo({ repoId: "o1" as RepoId, name: "other", path: "/q/other" });
    useReposStore.setState({ open: [repo(), other, wt], currentId: "r1" });
    const st = useReposStore.getState();
    st.select("nope");
    expect(useReposStore.getState().currentId).toBe("r1");
    // display order: r1, w1 (same group), o1
    st.nextTab(1);
    expect(useReposStore.getState().currentId).toBe("w1");
    st.nextTab(1);
    expect(useReposStore.getState().currentId).toBe("o1");
    st.nextTab(1);
    expect(useReposStore.getState().currentId).toBe("r1");
    st.nextTab(-1);
    expect(useReposStore.getState().currentId).toBe("o1");
  });

  it("forgetRecent removes the entry", async () => {
    m.removeRecent.mockResolvedValue(undefined);
    useReposStore.setState({ recent: [{ path: "/p/proj", name: "proj", lastOpened: 1 }] });
    await useReposStore.getState().forgetRecent("/p/proj");
    expect(useReposStore.getState().recent).toHaveLength(0);
  });
});
