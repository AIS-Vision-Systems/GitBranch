import { create } from "zustand";
import { gitIdentity } from "../ipc/identity";
import type { RepoId } from "../ipc/types";

interface IdentityEntry {
  name: string | null;
  email: string | null;
}

interface IdentityState {
  byRepo: Record<RepoId, IdentityEntry>;
  /** Loads the repo's git identity once; `force` re-reads it. Errors are ignored (identity is optional). */
  load: (repoId: RepoId, force?: boolean) => Promise<void>;
}

const inflight = new Set<RepoId>();

export const useIdentityStore = create<IdentityState>((set, get) => ({
  byRepo: {},
  load: async (repoId, force = false) => {
    if (!force && (get().byRepo[repoId] !== undefined || inflight.has(repoId))) return;
    inflight.add(repoId);
    try {
      const id = await gitIdentity(repoId);
      set((s) => ({
        byRepo: {
          ...s.byRepo,
          [repoId]: { name: id.name?.value ?? null, email: id.email?.value ?? null },
        },
      }));
    } catch {
      // Identity is optional.
    } finally {
      inflight.delete(repoId);
    }
  },
}));
