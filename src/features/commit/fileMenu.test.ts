import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoId } from "../../ipc/types";
import { NO_FILTER, useGraphStore } from "../../state/graph";
import { useUiStore } from "../../state/ui";
import type { FileListItem } from "./FileList";
import { blameRev, fileMenuItems, showFileHistory } from "./fileMenu";

const id = "r1" as RepoId;
const item = (target: FileListItem["target"], kind: FileListItem["kind"] = "modified") =>
  ({ key: "k", path: "a.ts", origPath: null, kind, target, label: "a.ts" }) as FileListItem;

describe("file menu", () => {
  beforeEach(() => {
    useUiStore.setState({ centerView: "diff", blameTarget: null });
  });

  it("blame rev is the commit for commit files, else the working tree", () => {
    expect(blameRev(item({ kind: "commit", oid: "abc", path: "a.ts" }))).toBe("abc");
    expect(blameRev(item({ kind: "unstaged", path: "a.ts" }))).toBeUndefined();
  });

  it("Blame opens the blame view; disabled for deleted/untracked", () => {
    const items = fileMenuItems(id, item({ kind: "commit", oid: "abc", path: "a.ts" }));
    const blame = items[0];
    if (blame?.kind !== "item") throw new Error("expected item");
    blame.onSelect();
    expect(useUiStore.getState().blameTarget).toEqual({ repoId: id, path: "a.ts", rev: "abc" });
    const del = fileMenuItems(id, item({ kind: "commit", oid: "abc", path: "a.ts" }, "deleted"));
    expect(del[0]).toMatchObject({ disabled: true });
    const untr = fileMenuItems(id, item({ kind: "untracked", path: "a.ts" }, "added"));
    expect(untr[1]).toMatchObject({ disabled: true });
  });

  it("showFileHistory sets the path filter, opens the bar and shows the graph", () => {
    const setFilter = vi.fn().mockResolvedValue(undefined);
    const openFilterBar = vi.fn();
    useGraphStore.setState({
      setFilter,
      openFilterBar,
      filters: { r1: { ...NO_FILTER, author: "bob" } },
    });
    showFileHistory(id, "a.ts");
    expect(setFilter).toHaveBeenCalledWith(id, { author: "bob", message: "", path: "a.ts" });
    expect(openFilterBar).toHaveBeenCalledWith(id);
    expect(useUiStore.getState().centerView).toBe("graph");
  });
});
