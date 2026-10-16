import { create } from "zustand";
import { listSubmodules, type Submodule, type SubmoduleState } from "../ipc/submodule";
import type { RepoId } from "../ipc/types";

interface SubmodulesState {
  byRepo: Record<RepoId, Submodule[]>;
  load: (repoId: RepoId) => Promise<void>;
  clear: (repoId: RepoId) => void;
}

export const NO_SUBMODULES: Submodule[] = [];

export const useSubmodulesStore = create<SubmodulesState>((set) => {
  // Replies from before a clear (repo closed) are dropped.
  const generation = new Map<RepoId, number>();
  // Coalescing: at most one load in flight per repo, plus one queued rerun.
  const inFlight = new Set<RepoId>();
  const rerun = new Set<RepoId>();

  const doLoad = async (repoId: RepoId): Promise<void> => {
    const gen = generation.get(repoId) ?? 0;
    try {
      const subs = await listSubmodules(repoId);
      if ((generation.get(repoId) ?? 0) !== gen) return;
      set((s) => ({ byRepo: { ...s.byRepo, [repoId]: subs } }));
    } catch {
      // Non-critical: the section keeps its last value; the next change retries.
    }
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
  };
});

/** Selector: the submodules of `repoId` (stable empty array when unknown). */
export function submodulesOf(s: Pick<SubmodulesState, "byRepo">, repoId: RepoId): Submodule[] {
  return s.byRepo[repoId] ?? NO_SUBMODULES;
}

const LABELS: Record<SubmoduleState, string> = {
  clean: "Clean",
  modified: "Modified",
  uninitialized: "Not initialized",
  conflict: "Conflict",
};

/** Badge text for a submodule state. */
export function submoduleStateLabel(state: SubmoduleState): string {
  return LABELS[state];
}
