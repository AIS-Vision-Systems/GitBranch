import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphPage, Ref, RepoId, Refs } from "../ipc/types";
import { cleanStatus, commit, noRefs, row } from "../test/graphFixtures";

vi.mock("../ipc/graph", () => ({
  loadGraph: vi.fn(),
  listRefs: vi.fn(),
  repoStatus: vi.fn(),
}));

import * as ipc from "../ipc/graph";
import { refsByOid, useGraphStore, WIP_OID } from "./graph";

const m = vi.mocked(ipc);
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
});
