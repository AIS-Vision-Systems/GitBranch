import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ipc/graph", () => ({
  loadGraph: vi.fn(),
  listRefs: vi.fn(),
  repoStatus: vi.fn(),
}));

vi.mock("../ipc/stash", () => ({ stashList: vi.fn().mockResolvedValue([]) }));
vi.mock("../ipc/merge", () => ({ opState: vi.fn().mockResolvedValue(null) }));
vi.mock("../ipc/reflog", () => ({ undoPreview: vi.fn().mockResolvedValue(null) }));
vi.mock("./ui", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  reportError: vi.fn(),
}));

import * as ipc from "../ipc/graph";
import type { RepoId } from "../ipc/types";
import { reportError } from "./ui";
import { buildQuery, EMPTY_GRAPH, filterActive, NO_FILTER, useGraphStore } from "./graph";

describe("buildQuery", () => {
  it("omits empty filter fields and trims", () => {
    expect(buildQuery(0, 10, undefined)).toEqual({ order: "date", skip: 0, limit: 10, all: true });
    expect(buildQuery(5, 10, { author: " ann ", message: "", path: "src" })).toEqual({
      order: "date",
      skip: 5,
      limit: 10,
      all: true,
      author: "ann",
      path: "src",
    });
  });
  it("detects an active filter", () => {
    expect(filterActive(NO_FILTER)).toBe(false);
    expect(filterActive({ ...NO_FILTER, message: "fix" })).toBe(true);
  });
});

const R1 = "r1" as unknown as RepoId;

describe("setFilter", () => {
  beforeEach(() => {
    useGraphStore.setState({ byRepo: {}, filters: {} });
    vi.mocked(ipc.loadGraph).mockReset();
  });

  it("stores the filter without loading when the repo is not loaded", async () => {
    await useGraphStore.getState().setFilter(R1, { ...NO_FILTER, author: "bob" });
    expect(useGraphStore.getState().filters["r1"]?.author).toBe("bob");
    expect(ipc.loadGraph).not.toHaveBeenCalled();
  });

  it("ignores an unchanged filter", async () => {
    await useGraphStore.getState().setFilter(R1, NO_FILTER);
    expect(useGraphStore.getState().filters["r1"]).toBeUndefined();
  });
});

describe("filter errors and bar visibility", () => {
  const R2 = "r2" as unknown as RepoId;

  beforeEach(() => {
    useGraphStore.setState({ byRepo: {}, filters: {}, filterBarOpen: {}, filterError: {} });
    vi.mocked(reportError).mockClear();
  });

  it("opens the bar per repo", () => {
    useGraphStore.getState().openFilterBar(R1);
    expect(useGraphStore.getState().filterBarOpen[R1 as string]).toBe(true);
    expect(useGraphStore.getState().filterBarOpen[R2 as string]).toBeUndefined();
    useGraphStore.getState().closeFilterBar(R1);
    expect(useGraphStore.getState().filterBarOpen[R1 as string]).toBe(false);
  });

  it("keeps a failing filter error inline, then clears it on success", async () => {
    useGraphStore.setState({ byRepo: { r1: { ...EMPTY_GRAPH } } });
    vi.mocked(ipc.loadGraph).mockRejectedValueOnce(new Error("bad path"));
    vi.mocked(ipc.listRefs).mockResolvedValue({ head: { oid: null }, refs: [] } as never);
    vi.mocked(ipc.repoStatus).mockResolvedValue({ entries: [] } as never);
    await useGraphStore.getState().setFilter(R1, { ...NO_FILTER, path: "/abs/par" });
    expect(useGraphStore.getState().filterError["r1"]).toBe("bad path");
    expect(reportError).not.toHaveBeenCalled();

    vi.mocked(ipc.loadGraph).mockResolvedValueOnce({
      commits: [],
      rows: [],
      hasMore: false,
      nextSkip: 0,
    });
    await useGraphStore.getState().setFilter(R1, { ...NO_FILTER, path: "src" });
    expect(useGraphStore.getState().filterError["r1"]).toBeUndefined();
  });

  it("still reports errors when no filter is active", async () => {
    useGraphStore.setState({ byRepo: { r1: { ...EMPTY_GRAPH } } });
    vi.mocked(ipc.loadGraph).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(ipc.listRefs).mockResolvedValue({ head: { oid: null }, refs: [] } as never);
    vi.mocked(ipc.repoStatus).mockResolvedValue({ entries: [] } as never);
    await useGraphStore.getState().refresh(R1, ["head"]);
    expect(reportError).toHaveBeenCalled();
  });
});
