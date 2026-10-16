import { create } from "zustand";
import * as ipc from "../ipc/graph";
import type { Change } from "../ipc/events";
import type { Commit, GraphQuery, Ref, RepoId, Refs, Row, Status } from "../ipc/types";
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
  status: Status | null;
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
}

export const EMPTY_GRAPH: GraphState = {
  commits: [],
  rows: [],
  byOid: new Map(),
  refs: null,
  status: null,
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

  /** Fetch page 0 + refs + status. `reset` blanks the view first (initial load). */
  const reload = async (repoId: RepoId, reset: boolean): Promise<void> => {
    const gen = bump(repoId);
    if (reset) {
      set((s) => ({ byRepo: { ...s.byRepo, [repoId]: { ...EMPTY_GRAPH, loading: true } } }));
    } else {
      patch(repoId, { loading: true, error: null });
    }
    try {
      const [page, refs, status] = await Promise.all([
        ipc.loadGraph(repoId, query(0, FIRST_PAGE)),
        ipc.listRefs(repoId),
        ipc.repoStatus(repoId),
      ]);
      if (generation.get(repoId) !== gen) return;
      const byOid = indexRows(page.rows);
      set((s) => ({
        byRepo: {
          ...s.byRepo,
          [repoId]: {
            commits: page.commits,
            rows: page.rows,
            byOid,
            refs,
            status,
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
      await reload(repoId, true);
    },

    loadMore: async (repoId) => {
      const g = get().byRepo[repoId];
      if (g === undefined || g.loading || !g.hasMore) return;
      const gen = generation.get(repoId) ?? 0;
      patch(repoId, { loading: true });
      try {
        const page = await ipc.loadGraph(repoId, query(g.nextSkip, NEXT_PAGE));
        if (generation.get(repoId) !== gen) return;
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
      if (what.includes("head") || what.includes("refs")) {
        await reload(repoId, false);
        return;
      }
      if (what.includes("index") || what.includes("workingTree")) {
        try {
          const status = await ipc.repoStatus(repoId);
          patch(repoId, { status });
        } catch (e) {
          reportError(e, "Could not refresh status");
        }
      }
    },

    select: (oid) => set({ selectedOid: oid }),
    setHover: (oid) => set({ hoverOid: oid }),
  };
});
