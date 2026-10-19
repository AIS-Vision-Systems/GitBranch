import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ipc from "../ipc/worktree";
import type { Worktree } from "../ipc/worktree";
import type { RepoId } from "../ipc/types";
import { useReposStore } from "./repos";
import { useUiStore } from "./ui";
import { useWorktreesStore, worktreesOf } from "./worktrees";

vi.mock("../ipc/worktree", () => ({
  listWorktrees: vi.fn(),
  addWorktree: vi.fn(),
  removeWorktree: vi.fn(),
  pruneWorktrees: vi.fn(),
  lockWorktree: vi.fn(),
  unlockWorktree: vi.fn(),
}));

const id = "r1" as RepoId;
const wt = (path: string): Worktree => ({
  path,
  headOid: null,
  branch: null,
  isMain: false,
  isBare: false,
  isDetached: false,
  locked: false,
  lockReason: null,
  prunable: false,
  pruneReason: null,
});

beforeEach(() => {
  vi.resetAllMocks();
  useWorktreesStore.setState({ byRepo: {} });
  useUiStore.setState({ toasts: [] });
});

describe("worktrees store", () => {
  it("loads and clears", async () => {
    vi.mocked(ipc.listWorktrees).mockResolvedValue([wt("/a")]);
    await useWorktreesStore.getState().load(id);
    expect(worktreesOf(useWorktreesStore.getState(), id)).toHaveLength(1);
    useWorktreesStore.getState().clear(id);
    expect(worktreesOf(useWorktreesStore.getState(), id)).toHaveLength(0);
  });

  it("drops a reply that lands after clear", async () => {
    let resolve!: (v: Worktree[]) => void;
    vi.mocked(ipc.listWorktrees).mockReturnValueOnce(
      new Promise<Worktree[]>((r) => {
        resolve = r;
      }),
    );
    const p = useWorktreesStore.getState().load(id);
    useWorktreesStore.getState().clear(id);
    resolve([wt("/x")]);
    await p;
    expect(useWorktreesStore.getState().byRepo[id]).toBeUndefined();
  });

  it("add reloads on success and toasts on failure", async () => {
    vi.mocked(ipc.listWorktrees).mockResolvedValue([wt("/a")]);
    vi.mocked(ipc.addWorktree).mockResolvedValueOnce(undefined);
    const co = { kind: "detached", revision: "HEAD" } as const;
    expect(await useWorktreesStore.getState().add(id, "/a", co, false)).toBe(true);
    expect(ipc.addWorktree).toHaveBeenCalledWith(id, "/a", co, false);
    expect(ipc.listWorktrees).toHaveBeenCalled();
    vi.mocked(ipc.addWorktree).mockRejectedValueOnce(new Error("boom"));
    expect(await useWorktreesStore.getState().add(id, "/b", co, false)).toBe(false);
    expect(useUiStore.getState().toasts[0]?.title).toBe("Could not add worktree");
  });

  it("remove drops the tabs the backend closed", async () => {
    vi.mocked(ipc.listWorktrees).mockResolvedValue([]);
    vi.mocked(ipc.removeWorktree).mockResolvedValue(["r2"]);
    const base = {
      name: "r",
      path: "/r",
      gitDir: "/r/.git",
      isWorktree: false,
      mainWorkTree: null,
      isBare: false,
    };
    useReposStore.setState({
      open: [
        { ...base, repoId: "r1" as RepoId },
        { ...base, repoId: "r2" as RepoId, path: "/a" },
      ],
      currentId: "r2",
    });
    expect(await useWorktreesStore.getState().remove(id, "/a", false)).toEqual({ ok: true });
    expect(useReposStore.getState().open.map((r) => r.repoId)).toEqual(["r1"]);
    expect(useReposStore.getState().currentId).toBe("r1");
  });

  it("remove succeeds", async () => {
    vi.mocked(ipc.listWorktrees).mockResolvedValue([]);
    vi.mocked(ipc.removeWorktree).mockResolvedValue([]);
    expect(await useWorktreesStore.getState().remove(id, "/a", false)).toEqual({ ok: true });
  });

  it.each([
    ["fatal: contains modified files, use --force to delete it", true],
    ["fatal: cannot remove a locked working tree; use 'remove -f -f' to override", false],
    ["something else", false],
  ])("remove detects needsForce for %j", async (message, needsForce) => {
    vi.mocked(ipc.removeWorktree).mockRejectedValue(new Error(message));
    const r = await useWorktreesStore.getState().remove(id, "/a", false);
    expect(r).toEqual({ ok: false, needsForce, message });
    expect(useUiStore.getState().toasts).toHaveLength(needsForce ? 0 : 1);
  });
});
