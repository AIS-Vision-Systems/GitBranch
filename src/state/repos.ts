import { create } from "zustand";
import type { Session } from "../ipc/app";
import { isIpcError } from "../ipc/core";
import * as ipc from "../ipc/repo";
import type { OpenedRepo, RecentRepo, RepoId } from "../ipc/types";
import { orderTabs } from "../lib/tabOrder";
import { samePath } from "../lib/paths";
import { useGraphStore } from "./graph";
import { reportError, useUiStore } from "./ui";

interface ReposState {
  open: OpenedRepo[];
  currentId: string | null;
  recent: RecentRepo[];
  /** Set when the opened folder is a linked worktree, until the user chooses. */
  pendingWorktree: OpenedRepo | null;
  loadRecent: () => Promise<void>;
  /** Resolves true when the repo was opened (or is awaiting the worktree choice). */
  openPath: (path: string) => Promise<boolean>;
  /** Opens a worktree as its own tab (no main/worktree prompt); selects it if already open. */
  openWorktree: (path: string) => Promise<void>;
  /** Reopens the saved tabs silently (no worktree prompt); failures toast and are skipped. */
  restoreSession: (session: Session) => Promise<void>;
  /** Shows the Welcome screen as a transient "new tab" while the repos stay open. */
  newTab: () => void;
  /** Switches the current tab. */
  select: (repoId: string) => void;
  /** Cycles the current tab in display order. */
  nextTab: (delta: 1 | -1) => void;
  openViaDialog: () => Promise<void>;
  resolveWorktree: (choice: "main" | "worktree") => Promise<void>;
  cancelWorktree: () => void;
  close: (repoId: string) => Promise<void>;
  /** Drops tabs the backend already closed (e.g. their worktree was removed). */
  dropClosed: (repoIds: readonly string[]) => void;
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
  /** Tab B must not inherit tab A's global selection/hover. */
  const resetSelection = (): void => {
    useGraphStore.setState({ selectedOid: null, hoverOid: null });
  };

  /** Neighbour of `repoId` in the displayed order (the one after it, else the one before). */
  const neighbour = (all: OpenedRepo[], repoId: string): string | null => {
    const tabs = orderTabs(all);
    const i = tabs.findIndex((r) => r.repoId === repoId);
    const rest = tabs.filter((r) => r.repoId !== repoId);
    if (rest.length === 0) return null;
    return (rest[Math.min(Math.max(i, 0), rest.length - 1)] ?? rest[0])?.repoId ?? null;
  };

  const show = (repo: OpenedRepo): void => {
    if (get().currentId !== repo.repoId) resetSelection();
    set((s) => ({
      open: s.open.some((r) => r.repoId === repo.repoId) ? s.open : [...s.open, repo],
      currentId: repo.repoId,
      pendingWorktree: null,
    }));
  };

  /** Undo the backend registration of a repo the user decided not to keep open. */
  const discard = async (repo: OpenedRepo): Promise<void> => {
    useGraphStore.getState().forget(repo.repoId);
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
          return true;
        }
        show(repo);
      } catch (e) {
        report(e, path);
        return false;
      }
      await get().loadRecent();
      return true;
    },

    openWorktree: async (path) => {
      const existing = get().open.find((r) => samePath(r.path, path));
      if (existing !== undefined) {
        get().select(existing.repoId);
        return;
      }
      try {
        show(await ipc.openRepo(path));
      } catch (e) {
        report(e, path);
        return;
      }
      await get().loadRecent();
    },

    restoreSession: async (session) => {
      let current: OpenedRepo | null = null;
      for (const path of session.open) {
        try {
          const repo = await ipc.openRepo(path);
          set((s) => ({
            open: s.open.some((r) => r.repoId === repo.repoId) ? s.open : [...s.open, repo],
          }));
          if (session.current !== null && samePath(path, session.current)) current = repo;
        } catch {
          useUiStore.getState().pushToast({ kind: "error", title: `Could not reopen ${path}` });
        }
      }
      if (current !== null) {
        resetSelection();
        set({ currentId: current.repoId });
      }
    },

    newTab: () => {
      if (get().currentId === null) return;
      resetSelection();
      set({ currentId: null });
    },

    select: (repoId) => {
      if (!get().open.some((r) => r.repoId === repoId) || get().currentId === repoId) return;
      resetSelection();
      set({ currentId: repoId });
    },

    nextTab: (delta) => {
      const tabs = orderTabs(get().open);
      if (tabs.length === 0) return;
      const i = tabs.findIndex((r) => r.repoId === get().currentId);
      const next = i < 0 ? tabs[0] : tabs[(i + delta + tabs.length) % tabs.length];
      if (next !== undefined) get().select(next.repoId);
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
        show(pending);
      } else {
        const mainPath = pending.mainWorkTree ?? pending.path;
        set({ pendingWorktree: null });
        await discard(pending);
        try {
          show(await ipc.openRepo(mainPath));
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
      useGraphStore.getState().forget(repoId as RepoId);
      set((s) => {
        const open = s.open.filter((r) => r.repoId !== repoId);
        const currentId = s.currentId === repoId ? neighbour(s.open, repoId) : s.currentId;
        if (currentId !== s.currentId) resetSelection();
        return { open, currentId };
      });
    },

    dropClosed: (repoIds) => {
      if (repoIds.length === 0) return;
      const gone = new Set(repoIds);
      for (const id of gone) useGraphStore.getState().forget(id as RepoId);
      set((s) => {
        const open = s.open.filter((r) => !gone.has(r.repoId));
        let currentId = s.currentId;
        if (currentId !== null && gone.has(currentId)) {
          const keep = orderTabs(s.open);
          const i = keep.findIndex((r) => r.repoId === currentId);
          const after = keep.slice(i + 1).find((r) => !gone.has(r.repoId));
          const before = keep
            .slice(0, i)
            .reverse()
            .find((r) => !gone.has(r.repoId));
          currentId = (after ?? before)?.repoId ?? null;
          resetSelection();
        }
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
