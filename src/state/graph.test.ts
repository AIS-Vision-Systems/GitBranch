import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphPage, Ref, RepoId, Refs } from "../ipc/types";
import { cleanStatus, commit, noRefs, row } from "../test/graphFixtures";

vi.mock("../ipc/stash", () => ({ stashList: vi.fn() }));
vi.mock("../ipc/merge", () => ({ opState: vi.fn() }));
vi.mock("../ipc/reflog", () => ({ undoPreview: vi.fn() }));
vi.mock("../ipc/graph", () => ({
  loadGraph: vi.fn(),
  listRefs: vi.fn(),
  repoStatus: vi.fn(),
}));

import * as ipc from "../ipc/graph";
import * as mergeIpc from "../ipc/merge";
import * as reflogIpc from "../ipc/reflog";
import * as stashIpc from "../ipc/stash";
import { useUiStore } from "./ui";
import { refsByOid, useGraphStore, WIP_OID } from "./graph";

const m = vi.mocked(ipc);
const stashes = vi.mocked(stashIpc);
const id = "r1" as RepoId;

function page(oids: string[], more: boolean, nextSkip: number): GraphPage {
  return {
    commits: oids.map((o) => commit(o)),
    rows: oids.map((o) => row(o)),
    hasMore: more,
    nextSkip,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  useGraphStore.setState({ byRepo: {}, selectedOid: null, hoverOid: null });
  m.listRefs.mockResolvedValue(noRefs);
  m.repoStatus.mockResolvedValue(cleanStatus);
  stashes.stashList.mockResolvedValue([]);
  vi.mocked(mergeIpc.opState).mockResolvedValue(null);
  vi.mocked(reflogIpc.undoPreview).mockResolvedValue(null);
  useUiStore.setState({ toasts: [] });
});

describe("graph store", () => {
  it("load fetches page, refs, status and indexes rows", async () => {
    m.loadGraph.mockResolvedValue(page(["a", "b"], true, 2));
    await useGraphStore.getState().load(id);
    const g = useGraphStore.getState().byRepo[id]!;
    expect(m.loadGraph).toHaveBeenCalledWith(id, {
      order: "date",
      skip: 0,
      limit: 2000,
      all: true,
    });
    expect(m.listRefs).toHaveBeenCalledTimes(1);
    expect(m.repoStatus).toHaveBeenCalledTimes(1);
    expect(g.byOid.get("b")).toBe(1);
    expect(g.hasMore).toBe(true);
    expect(g.nextSkip).toBe(2);
    expect(g.loading).toBe(false);
  });

  it("loadMore appends using nextSkip and is guarded", async () => {
    m.loadGraph.mockResolvedValueOnce(page(["a", "b"], true, 2));
    await useGraphStore.getState().load(id);
    m.loadGraph.mockResolvedValueOnce(page(["c"], false, 3));
    await useGraphStore.getState().loadMore(id);
    expect(m.loadGraph).toHaveBeenLastCalledWith(id, {
      order: "date",
      skip: 2,
      limit: 10000,
      all: true,
    });
    const g = useGraphStore.getState().byRepo[id]!;
    expect(g.rows.map((r) => r.oid)).toEqual(["a", "b", "c"]);
    expect(g.byOid.get("c")).toBe(2);
    m.loadGraph.mockClear();
    await useGraphStore.getState().loadMore(id);
    expect(m.loadGraph).not.toHaveBeenCalled();
  });

  it("refresh calls only the IPC functions its slice needs", async () => {
    m.loadGraph.mockResolvedValue(page(["a"], false, 1));
    await useGraphStore.getState().load(id);
    m.loadGraph.mockClear();
    m.listRefs.mockClear();
    m.repoStatus.mockClear();

    await useGraphStore.getState().refresh(id, ["workingTree"]);
    expect(m.repoStatus).toHaveBeenCalledTimes(1);
    expect(m.listRefs).not.toHaveBeenCalled();
    expect(m.loadGraph).not.toHaveBeenCalled();

    m.repoStatus.mockClear();
    await useGraphStore.getState().refresh(id, ["refs"]);
    expect(m.loadGraph).toHaveBeenCalledTimes(1);
    expect(m.listRefs).toHaveBeenCalledTimes(1);
  });

  it("keeps the selection across reload when the oid still exists, clears otherwise", async () => {
    m.loadGraph.mockResolvedValue(page(["a", "b"], false, 2));
    await useGraphStore.getState().load(id);
    useGraphStore.getState().select("b");
    await useGraphStore.getState().refresh(id, ["head"]);
    expect(useGraphStore.getState().selectedOid).toBe("b");

    m.loadGraph.mockResolvedValue(page(["a", "z"], false, 2));
    await useGraphStore.getState().refresh(id, ["head"]);
    expect(useGraphStore.getState().selectedOid).toBeNull();
  });

  it("keeps a WIP selection across reload", async () => {
    m.loadGraph.mockResolvedValue(page(["a"], false, 1));
    await useGraphStore.getState().load(id);
    useGraphStore.getState().select(WIP_OID);
    await useGraphStore.getState().refresh(id, ["head"]);
    expect(useGraphStore.getState().selectedOid).toBe(WIP_OID);
  });

  it("a reload of another open repo leaves the selection alone", async () => {
    const other = "r2" as RepoId;
    m.loadGraph.mockResolvedValueOnce(page(["x"], false, 1));
    await useGraphStore.getState().load(other);
    m.loadGraph.mockResolvedValueOnce(page(["a", "b"], false, 2));
    await useGraphStore.getState().load(id);
    useGraphStore.getState().select("b");
    // A watcher event (fetch, commit) in the background tab reloads it; "b" is not one of its commits.
    m.loadGraph.mockResolvedValueOnce(page(["x", "y"], false, 2));
    await useGraphStore.getState().refresh(other, ["refs"]);
    expect(useGraphStore.getState().selectedOid).toBe("b");
    expect(useGraphStore.getState().byRepo[other]!.rows.map((r) => r.oid)).toEqual(["x", "y"]);
  });

  it("a reload re-fetches every loaded row, so a selection past the first page survives", async () => {
    const first = Array.from({ length: 2000 }, (_, i) => `c${i}`);
    const more = Array.from({ length: 500 }, (_, i) => `d${i}`);
    m.loadGraph.mockResolvedValueOnce(page(first, true, 2000));
    await useGraphStore.getState().load(id);
    m.loadGraph.mockResolvedValueOnce(page(more, false, 2500));
    await useGraphStore.getState().loadMore(id);
    useGraphStore.getState().select("d400");

    m.loadGraph.mockResolvedValueOnce(page(first.concat(more), false, 2500));
    await useGraphStore.getState().refresh(id, ["head"]);
    expect(m.loadGraph).toHaveBeenLastCalledWith(id, {
      order: "date",
      skip: 0,
      limit: 2500,
      all: true,
    });
    const g = useGraphStore.getState().byRepo[id]!;
    expect(g.rows).toHaveLength(2500);
    expect(useGraphStore.getState().selectedOid).toBe("d400");
  });
});

describe("refsByOid", () => {
  it("groups refs by target", () => {
    const mk = (name: string, target: string): Ref => ({
      name,
      fullName: `refs/heads/${name}`,
      kind: "localBranch",
      target,
      upstream: null,
      isHead: false,
    });
    const refs: Refs = { ...noRefs, refs: [mk("a", "1"), mk("b", "1"), mk("c", "2")] };
    const map = refsByOid(refs);
    expect(map.get("1")?.map((r) => r.name)).toEqual(["a", "b"]);
    expect(map.get("2")?.length).toBe(1);
    expect(refsByOid(null).size).toBe(0);
  });

  it("forget drops the repo and clears its selection and hover", async () => {
    m.loadGraph.mockResolvedValue(page(["a", "b"], false, 2));
    await useGraphStore.getState().load(id);
    useGraphStore.getState().select("a");
    useGraphStore.getState().setHover("b");
    useGraphStore.getState().forget(id);
    const s = useGraphStore.getState();
    expect(s.byRepo[id]).toBeUndefined();
    expect(s.selectedOid).toBeNull();
    expect(s.hoverOid).toBeNull();
  });

  it("forget keeps the selection of another repo", async () => {
    m.loadGraph.mockResolvedValue(page(["a"], false, 1));
    await useGraphStore.getState().load(id);
    useGraphStore.setState({ selectedOid: "zzz" });
    useGraphStore.getState().forget(id);
    expect(useGraphStore.getState().selectedOid).toBe("zzz");
  });

  it("status-only refresh is ignored if a full reload happened meanwhile", async () => {
    m.loadGraph.mockResolvedValue(page(["a"], false, 1));
    await useGraphStore.getState().load(id);
    let resolveStale!: (v: typeof cleanStatus) => void;
    m.repoStatus.mockReturnValueOnce(
      new Promise((r) => {
        resolveStale = r;
      }),
    );
    const pending = useGraphStore.getState().refresh(id, ["workingTree"]);
    const fresh = {
      branch: { oid: "f", head: "fresh", upstream: null, ahead: 0, behind: 0 },
      entries: [],
    };
    m.repoStatus.mockResolvedValue(fresh);
    await useGraphStore.getState().load(id);
    resolveStale({ branch: null, entries: [] });
    await pending;
    expect(useGraphStore.getState().byRepo[id]!.status).toEqual(fresh);
  });

  it("loads stashes with the graph, reloads them on refs, and survives a failure", async () => {
    const entry = { index: 0, oid: "s0", branch: "main", message: "wip", time: 1 };
    m.loadGraph.mockResolvedValue(page(["a"], false, 1));
    stashes.stashList.mockResolvedValueOnce([entry]);
    await useGraphStore.getState().load(id);
    expect(useGraphStore.getState().byRepo[id]!.stashes).toEqual([entry]);

    stashes.stashList.mockResolvedValueOnce([]);
    await useGraphStore.getState().refresh(id, ["refs"]);
    expect(useGraphStore.getState().byRepo[id]!.stashes).toEqual([]);

    stashes.stashList.mockRejectedValueOnce(new Error("boom"));
    await useGraphStore.getState().refresh(id, ["refs"]);
    const g = useGraphStore.getState().byRepo[id]!;
    expect(g.stashes).toEqual([]);
    expect(g.error).toBeNull();
    expect(useUiStore.getState().toasts).toHaveLength(1);
  });

  it("loads inProgress and undo, refreshes them on index, and degrades to null with one error", async () => {
    const inProgress = {
      kind: "rebase" as const,
      headName: "feat",
      onto: "abc",
      done: 1,
      total: 3,
    };
    const undo = {
      label: "commit: x",
      action: { kind: "resetSoft" as const, target: "abc" },
    };
    m.loadGraph.mockResolvedValue(page(["a"], false, 1));
    vi.mocked(mergeIpc.opState).mockResolvedValueOnce(inProgress);
    vi.mocked(reflogIpc.undoPreview).mockResolvedValueOnce(undo);
    await useGraphStore.getState().load(id);
    let g = useGraphStore.getState().byRepo[id]!;
    expect(g.inProgress).toEqual(inProgress);
    expect(g.undo).toEqual(undo);

    // index change: cheap path, no graph reload
    await useGraphStore.getState().refresh(id, ["index"]);
    expect(m.loadGraph).toHaveBeenCalledTimes(1);
    expect(mergeIpc.opState).toHaveBeenCalledTimes(2);
    g = useGraphStore.getState().byRepo[id]!;
    expect(g.inProgress).toBeNull();
    expect(g.undo).toBeNull();

    // workingTree only: not re-read
    await useGraphStore.getState().refresh(id, ["workingTree"]);
    expect(mergeIpc.opState).toHaveBeenCalledTimes(2);

    vi.mocked(mergeIpc.opState).mockRejectedValueOnce(new Error("boom"));
    await useGraphStore.getState().refresh(id, ["head"]);
    g = useGraphStore.getState().byRepo[id]!;
    expect(g.inProgress).toBeNull();
    expect(g.error).toBeNull();
    expect(useUiStore.getState().toasts).toHaveLength(1);
  });
});
