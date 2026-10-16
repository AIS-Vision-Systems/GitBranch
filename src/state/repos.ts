import { create } from "zustand";
import { isIpcError } from "../ipc/core";
import * as ipc from "../ipc/repo";
import type { OpenedRepo, RecentRepo } from "../ipc/types";
import { reportError, useUiStore } from "./ui";

interface ReposState {
  open: OpenedRepo[];
  currentId: string | null;
  recent: RecentRepo[];
  /** Set when the opened folder is a linked worktree, until the user chooses. */
  pendingWorktree: OpenedRepo | null;
  loadRecent: () => Promise<void>;
  openPath: (path: string) => Promise<void>;
  openViaDialog: () => Promise<void>;
  resolveWorktree: (choice: "main" | "worktree") => Promise<void>;
  cancelWorktree: () => void;
  close: (repoId: string) => Promise<void>;
  forgetRecent: (path: string) => Promise<void>;
}

function report(e: unknown, path: string): void {
  if (isIpcError(e) && e.error.code === "git.not_a_repo") {
    useUiStore.getState().pushToast({ kind: "error", title: "Not a git repository", detail: path });
    return;
  }
  reportError(e, "Could not open repository");
}

export const useReposStore = create<ReposState>((set, get) => {
  const select = (repo: OpenedRepo): void => {
    set((s) => ({
      open: s.open.some((r) => r.repoId === repo.repoId) ? s.open : [...s.open, repo],
      currentId: repo.repoId,
      pendingWorktree: null,
    }));
  };

  /** Undo the backend registration of a repo the user decided not to keep open. */
  const discard = async (repo: OpenedRepo): Promise<void> => {
    try {
      await ipc.closeRepo(repo.repoId);
      await ipc.removeRecent(repo.path);
    } catch (e) {
      reportError(e, "Could not discard repository");
    }
  };

  return {
    open: [],
    currentId: null,
    recent: [],
    pendingWorktree: null,

    loadRecent: async () => {
      try {
        set({ recent: await ipc.listRecent() });
      } catch (e) {
        reportError(e, "Could not load recent repositories");
      }
    },

    openPath: async (path) => {
      try {
        const repo = await ipc.openRepo(path);
        if (repo.isWorktree && repo.mainWorkTree !== null) {
          set({ pendingWorktree: repo });
          return;
        }
        select(repo);
      } catch (e) {
        report(e, path);
        return;
      }
      await get().loadRecent();
    },

    openViaDialog: async () => {
      let path: string | null;
      try {
        path = await ipc.pickRepoDir();
      } catch (e) {
        reportError(e, "Could not open repository");
        return;
      }
      if (path === null) return;
      await get().openPath(path);
    },

    resolveWorktree: async (choice) => {
      const pending = get().pendingWorktree;
      if (pending === null) return;
      if (choice === "worktree") {
        select(pending);
      } else {
        const mainPath = pending.mainWorkTree ?? pending.path;
        set({ pendingWorktree: null });
        await discard(pending);
        try {
          select(await ipc.openRepo(mainPath));
        } catch (e) {
          report(e, mainPath);
          return;
        }
      }
      await get().loadRecent();
    },

    cancelWorktree: () => {
      const pending = get().pendingWorktree;
      set({ pendingWorktree: null });
      if (pending !== null) void discard(pending).then(() => get().loadRecent());
    },

    close: async (repoId) => {
      try {
        await ipc.closeRepo(repoId);
      } catch (e) {
        reportError(e, "Could not close repository");
      }
      set((s) => {
        const open = s.open.filter((r) => r.repoId !== repoId);
        const currentId =
          s.currentId === repoId ? (open[open.length - 1]?.repoId ?? null) : s.currentId;
        return { open, currentId };
      });
    },

    forgetRecent: async (path) => {
      try {
        await ipc.removeRecent(path);
        set((s) => ({ recent: s.recent.filter((r) => r.path !== path) }));
      } catch (e) {
        reportError(e, "Could not remove recent repository");
      }
    },
  };
});
