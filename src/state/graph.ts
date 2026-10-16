import { create } from "zustand";
import * as ipc from "../ipc/graph";
import { opState, type InProgress } from "../ipc/merge";
import { undoPreview, type UndoInfo } from "../ipc/reflog";
import { stashList, type StashEntry } from "../ipc/stash";
import type { Change } from "../ipc/events";
import type { Commit, GraphQuery, Ref, RepoId, Refs, Row, Status } from "../ipc/types";
import { useRemotesStore } from "./remotes";
import { submodulesOf, useSubmodulesStore } from "./submodules";
import { reportError } from "./ui";

export const FIRST_PAGE = 2000;
export const NEXT_PAGE = 10000;
/** Sentinel selection oid for the synthetic working-tree row. */
export const WIP_OID = "WIP";

export interface GraphState {
  commits: Commit[];
  rows: Row[];
  /** oid -> row index. */
  byOid: Map<string, number>;
  refs: Refs | null;
  stashes: StashEntry[];
  status: Status | null;
  /** Merge/rebase/cherry-pick/revert currently stopped, if any. */
  inProgress: InProgress | null;
  /** What "Undo last operation" would do, if anything. */
  undo: UndoInfo | null;
  hasMore: boolean;
  nextSkip: number;
  loading: boolean;
  error: string | null;
}

interface GraphStore {
  byRepo: Record<string, GraphState>;
  selectedOid: string | null;
  hoverOid: string | null;
  load: (repoId: RepoId) => Promise<void>;
  loadMore: (repoId: RepoId) => Promise<void>;
  refresh: (repoId: RepoId, what: Change[]) => Promise<void>;
  select: (oid: string | null) => void;
  setHover: (oid: string | null) => void;
  /** Drop all cached state for a closed repo. */
  forget: (repoId: RepoId) => void;
}

export const EMPTY_GRAPH: GraphState = {
  commits: [],
  rows: [],
  byOid: new Map(),
  refs: null,
  stashes: [],
  status: null,
  inProgress: null,
  undo: null,
  hasMore: false,
  nextSkip: 0,
  loading: false,
  error: null,
};

/** Group refs by the commit they point at. */
export function refsByOid(refs: Refs | null): Map<string, Ref[]> {
  const m = new Map<string, Ref[]>();
  if (refs === null) return m;
  for (const r of refs.refs) {
    const list = m.get(r.target);
    if (list === undefined) m.set(r.target, [r]);
    else list.push(r);
  }
  return m;
}

function indexRows(rows: Row[], from = 0, into = new Map<string, number>()): Map<string, number> {
  for (let i = from; i < rows.length; i++) into.set(rows[i]!.oid, i);
  return into;
}

function query(skip: number, limit: number): GraphQuery {
  return { order: "date", skip, limit, all: true };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Bumped on every full (re)load so stale responses are dropped.
const generation = new Map<string, number>();
const bump = (id: string): number => {
  const g = (generation.get(id) ?? 0) + 1;
  generation.set(id, g);
  return g;
};

export const useGraphStore = create<GraphStore>((set, get) => {
  const patch = (id: string, p: Partial<GraphState>): void =>
    set((s) => ({
      byRepo: { ...s.byRepo, [id]: { ...(s.byRepo[id] ?? EMPTY_GRAPH), ...p } },
    }));

  /** A failed stash_list must not fail the graph. */
  const loadStashes = async (repoId: RepoId): Promise<StashEntry[]> => {
    try {
      return await stashList(repoId);
    } catch (e) {
      reportError(e, "Could not load stashes");
      return [];
    }
  };

  /** Cheap side queries; a failure degrades to `null` with a single error report. */
  const loadOpState = async (
    repoId: RepoId,
  ): Promise<{ inProgress: InProgress | null; undo: UndoInfo | null }> => {
    const [a, b] = await Promise.allSettled([opState(repoId), undoPreview(repoId)]);
    const failed: unknown =
      a.status === "rejected" ? a.reason : b.status === "rejected" ? b.reason : null;
    if (failed !== null) reportError(failed, "Could not read the operation state");
    return {
      inProgress: a.status === "fulfilled" ? a.value : null,
      undo: b.status === "fulfilled" ? b.value : null,
    };
  };

  /** Fetch page 0 + refs + status. `reset` blanks the view first (initial load). */
  const reload = async (repoId: RepoId, reset: boolean): Promise<void> => {
    const gen = bump(repoId);
    const t0 = performance.now();
    if (reset) {
      set((s) => ({ byRepo: { ...s.byRepo, [repoId]: { ...EMPTY_GRAPH, loading: true } } }));
    } else {
      patch(repoId, { loading: true, error: null });
    }
    try {
      const timed = async <T>(p: Promise<T>): Promise<[T, number]> => [
        await p,
        performance.now() - t0,
      ];
      const [[page, tPage], [refs, tRefs], [status, tStatus], stashes, opInfo] = await Promise.all([
        timed(ipc.loadGraph(repoId, query(0, FIRST_PAGE))),
        timed(ipc.listRefs(repoId)),
        timed(ipc.repoStatus(repoId)),
        loadStashes(repoId),
        loadOpState(repoId),
      ]);
      if (generation.get(repoId) !== gen) return;
      if (import.meta.env.DEV) {
        console.info(
          `[graph] first page: ${page.rows.length} rows in ${tPage.toFixed(1)} ms (refs ${tRefs.toFixed(1)} ms, status ${tStatus.toFixed(1)} ms)`,
        );
      }
      const byOid = indexRows(page.rows);
      set((s) => ({
        byRepo: {
          ...s.byRepo,
          [repoId]: {
            commits: page.commits,
            rows: page.rows,
            byOid,
            refs,
            stashes,
            status,
            inProgress: opInfo.inProgress,
            undo: opInfo.undo,
            hasMore: page.hasMore,
            nextSkip: page.nextSkip,
            loading: false,
            error: null,
          },
        },
        selectedOid:
          s.selectedOid === null || s.selectedOid === WIP_OID || byOid.has(s.selectedOid)
            ? s.selectedOid
            : null,
      }));
    } catch (e) {
      if (generation.get(repoId) !== gen) return;
      patch(repoId, { loading: false, error: msg(e) });
      reportError(e, "Could not load the commit graph");
    }
  };

  return {
    byRepo: {},
    selectedOid: null,
    hoverOid: null,

    load: async (repoId) => {
      set({ selectedOid: null, hoverOid: null });
      void useRemotesStore.getState().load(repoId);
      void useSubmodulesStore.getState().load(repoId);
      await reload(repoId, true);
    },

    loadMore: async (repoId) => {
      const g = get().byRepo[repoId];
      if (g === undefined || g.loading || !g.hasMore) return;
      const gen = generation.get(repoId) ?? 0;
      patch(repoId, { loading: true });
      const t0 = performance.now();
      try {
        const page = await ipc.loadGraph(repoId, query(g.nextSkip, NEXT_PAGE));
        if (generation.get(repoId) !== gen) return;
        if (import.meta.env.DEV) {
          console.info(
            `[graph] chunk: ${page.rows.length} rows in ${(performance.now() - t0).toFixed(1)} ms`,
          );
        }
        const cur = get().byRepo[repoId] ?? g;
        const rows = cur.rows.concat(page.rows);
        patch(repoId, {
          commits: cur.commits.concat(page.commits),
          rows,
          byOid: indexRows(rows, cur.rows.length, new Map(cur.byOid)),
          hasMore: page.hasMore,
          nextSkip: page.nextSkip,
          loading: false,
        });
      } catch (e) {
        if (generation.get(repoId) !== gen) return;
        patch(repoId, { loading: false, error: msg(e) });
        reportError(e, "Could not load more commits");
      }
    },

    refresh: async (repoId, what) => {
      if (get().byRepo[repoId] === undefined) return;
      if (what.includes("refs")) void useRemotesStore.getState().load(repoId);
      if (
        what.includes("head") ||
        what.includes("index") ||
        (what.includes("workingTree") &&
          submodulesOf(useSubmodulesStore.getState(), repoId).length > 0)
      ) {
        void useSubmodulesStore.getState().load(repoId);
      }
      if (what.includes("head") || what.includes("refs")) {
        await reload(repoId, false);
        return;
      }
      if (what.includes("index") || what.includes("workingTree")) {
        try {
          const gen = generation.get(repoId) ?? 0;
          const withOps = what.includes("index");
          const [status, opInfo] = await Promise.all([
            ipc.repoStatus(repoId),
            withOps ? loadOpState(repoId) : Promise.resolve({}),
          ]);
          if ((generation.get(repoId) ?? 0) !== gen) return;
          patch(repoId, { status, ...opInfo });
        } catch (e) {
          reportError(e, "Could not refresh status");
        }
      }
    },

    forget: (repoId) => {
      bump(repoId);
      useRemotesStore.getState().clear(repoId);
      useSubmodulesStore.getState().clear(repoId);
      set((s) => {
        const byRepo = { ...s.byRepo };
        delete byRepo[repoId];
        const owned = (oid: string | null): boolean =>
          oid !== null && (oid === WIP_OID || s.byRepo[repoId]?.byOid.has(oid) === true);
        return {
          byRepo,
          selectedOid: owned(s.selectedOid) ? null : s.selectedOid,
          hoverOid: owned(s.hoverOid) ? null : s.hoverOid,
        };
      });
    },

    select: (oid) => set({ selectedOid: oid }),
    setHover: (oid) => set({ hoverOid: oid }),
  };
});
