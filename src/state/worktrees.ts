import { create } from "zustand";
import * as ipc from "../ipc/worktree";
import type { Worktree, WorktreeCheckout } from "../ipc/worktree";
import type { RepoId } from "../ipc/types";
import { useReposStore } from "./repos";
import { reportError } from "./ui";

export type RemoveResult = { ok: true } | { ok: false; needsForce: boolean; message: string };

interface WorktreesState {
  byRepo: Record<RepoId, Worktree[]>;
  load: (repoId: RepoId) => Promise<void>;
  clear: (repoId: RepoId) => void;
  add: (
    repoId: RepoId,
    path: string,
    checkout: WorktreeCheckout,
    force: boolean,
  ) => Promise<boolean>;
  remove: (repoId: RepoId, path: string, force: boolean) => Promise<RemoveResult>;
  prune: (repoId: RepoId) => Promise<boolean>;
  lock: (repoId: RepoId, path: string, reason: string | null) => Promise<boolean>;
  unlock: (repoId: RepoId, path: string) => Promise<boolean>;
}

export const NO_WORKTREES: Worktree[] = [];

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const useWorktreesStore = create<WorktreesState>((set, get) => {
  // Replies from before a clear (repo closed) are dropped.
  const generation = new Map<RepoId, number>();
  // Coalescing: at most one load in flight per repo, plus one queued rerun.
  const inFlight = new Set<RepoId>();
  const rerun = new Set<RepoId>();

  const doLoad = async (repoId: RepoId): Promise<void> => {
    const gen = generation.get(repoId) ?? 0;
    try {
      const list = await ipc.listWorktrees(repoId);
      if ((generation.get(repoId) ?? 0) !== gen) return;
      set((s) => ({ byRepo: { ...s.byRepo, [repoId]: list } }));
    } catch {
      // Non-critical: the section keeps its last value; the next change retries.
    }
  };

  /** Run a mutation; reload on success, toast on failure. */
  const mutate = async (
    repoId: RepoId,
    errorTitle: string,
    fn: () => Promise<void>,
  ): Promise<boolean> => {
    try {
      await fn();
    } catch (e) {
      reportError(e, errorTitle);
      return false;
    }
    void get().load(repoId);
    return true;
  };

  return {
    byRepo: {},

    load: async (repoId) => {
      if (inFlight.has(repoId)) {
        rerun.add(repoId);
        return;
      }
      inFlight.add(repoId);
      try {
        do {
          rerun.delete(repoId);
          await doLoad(repoId);
        } while (rerun.has(repoId));
      } finally {
        inFlight.delete(repoId);
      }
    },

    clear: (repoId) => {
      generation.set(repoId, (generation.get(repoId) ?? 0) + 1);
      rerun.delete(repoId);
      set((s) => {
        const byRepo = { ...s.byRepo };
        delete byRepo[repoId];
        return { byRepo };
      });
    },

    add: (repoId, path, checkout, force) =>
      mutate(repoId, "Could not add worktree", () =>
        ipc.addWorktree(repoId, path, checkout, force),
      ),

    remove: async (repoId, path, force) => {
      let closed: string[];
      try {
        closed = await ipc.removeWorktree(repoId, path, force);
      } catch (e) {
        const message = messageOf(e);
        // git: "contains modified or untracked files, use --force to delete it" (dirty) vs
        // "cannot remove a locked working tree" (never forced from the app: unlock first).
        const needsForce = message.includes("--force") && !message.includes("locked");
        if (!needsForce) reportError(e, "Could not remove worktree");
        return { ok: false, needsForce, message };
      }
      if (closed.length > 0) useReposStore.getState().dropClosed(closed);
      if (!closed.includes(repoId)) void get().load(repoId);
      return { ok: true };
    },

    prune: (repoId) =>
      mutate(repoId, "Could not prune worktrees", () => ipc.pruneWorktrees(repoId)),

    lock: (repoId, path, reason) =>
      mutate(repoId, "Could not lock worktree", () => ipc.lockWorktree(repoId, path, reason)),

    unlock: (repoId, path) =>
      mutate(repoId, "Could not unlock worktree", () => ipc.unlockWorktree(repoId, path)),
  };
});

/** Selector: the worktrees of `repoId` (stable empty array when unknown). */
export function worktreesOf(s: Pick<WorktreesState, "byRepo">, repoId: RepoId): Worktree[] {
  return s.byRepo[repoId] ?? NO_WORKTREES;
}
