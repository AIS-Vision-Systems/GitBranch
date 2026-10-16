import { create } from "zustand";
import { listRemotes, type Remote } from "../ipc/remote";
import type { RepoId } from "../ipc/types";

interface RemotesState {
  byRepo: Record<RepoId, Remote[]>;
  load: (repoId: RepoId) => Promise<void>;
  clear: (repoId: RepoId) => void;
}

export const NO_REMOTES: Remote[] = [];

export const useRemotesStore = create<RemotesState>((set) => {
  // Replies from before a clear (repo closed) are dropped.
  const generation = new Map<RepoId, number>();
  // Per-repo load sequence: only the latest load may write.
  const seq = new Map<RepoId, number>();
  return {
    byRepo: {},

    load: async (repoId) => {
      const gen = generation.get(repoId) ?? 0;
      const mine = (seq.get(repoId) ?? 0) + 1;
      seq.set(repoId, mine);
      try {
        const remotes = await listRemotes(repoId);
        if ((generation.get(repoId) ?? 0) !== gen || seq.get(repoId) !== mine) return;
        set((s) => ({ byRepo: { ...s.byRepo, [repoId]: remotes } }));
      } catch {
        // Non-critical: buttons stay as they were; the next refs change retries.
      }
    },

    clear: (repoId) => {
      generation.set(repoId, (generation.get(repoId) ?? 0) + 1);
      set((s) => {
        const byRepo = { ...s.byRepo };
        delete byRepo[repoId];
        return { byRepo };
      });
    },
  };
});

/** Selector: the remotes of `repoId` (stable empty array when unknown). */
export function remotesOf(s: Pick<RemotesState, "byRepo">, repoId: RepoId): Remote[] {
  return s.byRepo[repoId] ?? NO_REMOTES;
}
