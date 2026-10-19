import { create } from "zustand";
import { isIpcError } from "../ipc/core";
import * as ipc from "../ipc/github";
import type { GithubRepoSlug, PullDetail, PullState, PullSummary } from "../ipc/github";
import type { RepoId } from "../ipc/types";
import { useDetailsStore } from "./details";
import { useGraphStore } from "./graph";
import { useGithubStore } from "./github";
import { useOpsStore } from "./ops";
import { useRemotesStore } from "./remotes";

export type PullFilter = "open" | "closed" | "mine";

export interface PullsRepo {
  /** undefined = not loaded yet, null = not a GitHub repo. */
  slug: GithubRepoSlug | null | undefined;
  filter: PullFilter;
  pulls: PullSummary[];
  /** True once a list has been loaded for the current filter. */
  loaded: boolean;
  loading: boolean;
  error: string | null;
  /** Error code of the last failure (e.g. `github.unauthorized`). */
  errorCode: string | null;
  selected: number | null;
  detail: PullDetail | null;
  detailLoading: boolean;
  detailError: string | null;
}

export const EMPTY_PULLS: PullsRepo = {
  slug: undefined,
  filter: "open",
  pulls: [],
  loaded: false,
  loading: false,
  error: null,
  errorCode: null,
  selected: null,
  detail: null,
  detailLoading: false,
  detailError: null,
};

interface PullsState {
  byRepo: Record<RepoId, PullsRepo>;
  loadSlug: (repoId: RepoId) => Promise<void>;
  loadPulls: (repoId: RepoId, force?: boolean) => Promise<void>;
  setFilter: (repoId: RepoId, filter: PullFilter) => Promise<void>;
  select: (repoId: RepoId, number: number | null) => Promise<void>;
  refresh: (repoId: RepoId) => Promise<void>;
  /** Resolves with the local branch name, or null on failure. */
  checkout: (repoId: RepoId, pull: PullSummary) => Promise<string | null>;
  clearAll: () => void;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const codeOf = (e: unknown): string => (isIpcError(e) ? e.error.code : "ipc.unknown");

const STATE_OF: Record<PullFilter, PullState> = { open: "open", closed: "closed", mine: "all" };

export function pullsOf(s: Pick<PullsState, "byRepo">, repoId: RepoId): PullsRepo {
  return s.byRepo[repoId] ?? EMPTY_PULLS;
}

const UNAUTHORIZED = "github.unauthorized";

export const usePullsStore = create<PullsState>((set, get) => {
  // Per-repo request counters: a newer request for the same repo supersedes the older reply.
  const listGen = new Map<RepoId, number>();
  const detailGen = new Map<RepoId, number>();
  const bump = (m: Map<RepoId, number>, id: RepoId): number => {
    const n = (m.get(id) ?? 0) + 1;
    m.set(id, n);
    return n;
  };

  const patch = (repoId: RepoId, p: Partial<PullsRepo>): void =>
    set((s) => ({ byRepo: { ...s.byRepo, [repoId]: { ...pullsOf(s, repoId), ...p } } }));

  /** Reset every repo's data, keeping slug and filter; `errorCode` stays sticky when given. */
  const resetAll = (errorCode: string | null): void => {
    for (const id of Object.keys(get().byRepo)) {
      bump(listGen, id as RepoId);
      bump(detailGen, id as RepoId);
    }
    set((s) => ({
      byRepo: Object.fromEntries(
        Object.entries(s.byRepo).map(([id, r]) => [
          id,
          { ...EMPTY_PULLS, slug: r.slug, filter: r.filter, errorCode },
        ]),
      ),
    }));
  };

  /** A 401: drop the account locally so nothing retries until the user signs in again. */
  const unauthorized = (): void => {
    resetAll(UNAUTHORIZED);
    useGithubStore.getState().signedOut();
  };

  return {
    byRepo: {},

    loadSlug: async (repoId) => {
      try {
        const slug = await ipc.githubRepoSlug(repoId);
        patch(repoId, { slug });
      } catch {
        // Non-critical: not a GitHub repo as far as we can tell; the section stays hidden.
        patch(repoId, { slug: null });
      }
    },

    loadPulls: async (repoId, force = false) => {
      const cur = pullsOf(get(), repoId);
      const filter = cur.filter;
      if (!force) {
        if (cur.loading || cur.loaded) return;
        // A failure stays until Retry; a 401 clears once the user signs in again.
        if (cur.errorCode !== null && cur.errorCode !== UNAUTHORIZED) return;
      }
      const account = useGithubStore.getState().account;
      if (account === null || account === undefined) return; // signed out or not loaded yet
      const login = account.user.login;
      const gen = bump(listGen, repoId);
      patch(repoId, { loading: true, error: null, errorCode: null });
      try {
        let pulls = await ipc.githubPulls(repoId, STATE_OF[filter]);
        if (gen !== listGen.get(repoId)) return;
        if (filter === "mine") pulls = pulls.filter((p) => p.author === login);
        patch(repoId, { pulls, loaded: true, loading: false });
      } catch (e) {
        if (gen !== listGen.get(repoId)) return;
        if (codeOf(e) === UNAUTHORIZED) return unauthorized();
        patch(repoId, { loading: false, error: messageOf(e), errorCode: codeOf(e) });
      }
    },

    setFilter: async (repoId, filter) => {
      bump(listGen, repoId);
      patch(repoId, {
        filter,
        pulls: [],
        loaded: false,
        loading: false,
        error: null,
        errorCode: null,
      });
      await get().loadPulls(repoId);
    },

    select: async (repoId, number) => {
      const gen = bump(detailGen, repoId);
      if (number === null) {
        patch(repoId, { selected: null, detail: null, detailLoading: false, detailError: null });
        return;
      }
      // Selecting a PR replaces the commit details.
      useDetailsStore.getState().clear();
      useGraphStore.getState().select(null);
      patch(repoId, { selected: number, detail: null, detailLoading: true, detailError: null });
      try {
        const detail = await ipc.githubPull(repoId, number);
        if (gen !== detailGen.get(repoId)) return;
        patch(repoId, { detail, detailLoading: false });
      } catch (e) {
        if (gen !== detailGen.get(repoId)) return;
        if (codeOf(e) === "github.unauthorized") return unauthorized();
        patch(repoId, { detailLoading: false, detailError: messageOf(e) });
      }
    },

    refresh: async (repoId) => {
      const sel = pullsOf(get(), repoId).selected;
      const list = get().loadPulls(repoId, true);
      if (sel !== null) await get().select(repoId, sel);
      await list;
    },

    checkout: (repoId, pull) => {
      const slug = pullsOf(get(), repoId).slug;
      if (slug === null || slug === undefined) return Promise.resolve(null);
      return useOpsStore.getState().checkoutPull(repoId, pull.number, {
        remote: slug.remote,
        number: pull.number,
        headRef: pull.headRef,
        sameRepo: pull.headRepo === pull.baseRepo,
      });
    },

    clearAll: () => resetAll(null),
  };
});

// Signing out drops all cached pull requests.
useGithubStore.subscribe((s, prev) => {
  if (s.account === null && prev.account !== null) usePullsStore.getState().clearAll();
});

// Selecting a commit (or the WIP row) leaves the pull request view.
useGraphStore.subscribe((s, prev) => {
  if (s.selectedOid === null || s.selectedOid === prev.selectedOid) return;
  const { byRepo, select } = usePullsStore.getState();
  for (const [id, r] of Object.entries(byRepo)) {
    if (r.selected !== null) void select(id as RepoId, null);
  }
});

// Remotes changed: the cached slug may be stale; the section reloads it.
useRemotesStore.subscribe((s, prev) => {
  const { byRepo } = usePullsStore.getState();
  for (const id of Object.keys(byRepo) as RepoId[]) {
    if (s.byRepo[id] === prev.byRepo[id] || byRepo[id]?.slug === undefined) continue;
    usePullsStore.setState((st) => ({
      byRepo: { ...st.byRepo, [id]: { ...pullsOf(st, id), slug: undefined, loaded: false } },
    }));
  }
});
