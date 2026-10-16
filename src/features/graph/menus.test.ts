import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ref, RepoId } from "../../ipc/types";
import { useDialogsStore } from "../../state/dialogs";
import { useOpsStore } from "../../state/ops";
import { useWipStore } from "../../state/wip";
import { commit } from "../../test/graphFixtures";
import type { MenuItem } from "../shell/ContextMenu";
import { commitMenu, refMenu, wipMenu, type MenuContext } from "./menus";

const repoId = "r1" as RepoId;
const oid = "a".repeat(40);
const ctx: MenuContext = {
  repoId,
  commit: commit(oid),
  refs: [],
  head: { oid: "b".repeat(40), branch: "main", detached: false },
  inProgress: false,
};

function ref(over: Partial<Ref>): Ref {
  return {
    name: "feat",
    fullName: "refs/heads/feat",
    kind: "localBranch",
    target: oid,
    upstream: null,
    isHead: false,
    ...over,
  };
}

const items = (m: MenuItem[]): Extract<MenuItem, { kind: "item" }>[] =>
  m.filter((i): i is Extract<MenuItem, { kind: "item" }> => i.kind === "item");
const labels = (m: MenuItem[]): string[] => items(m).map((i) => i.label);
const find = (m: MenuItem[], id: string): Extract<MenuItem, { kind: "item" }> => {
  const it = items(m).find((i) => i.id === id);
  if (it === undefined) throw new Error(`no item ${id}`);
  return it;
};

beforeEach(() => {
  useDialogsStore.setState({ current: null, busy: false });
});

describe("commitMenu", () => {
  it("lists the commit actions with separators", () => {
    const m = commitMenu(ctx);
    expect(labels(m)).toEqual([
      "Checkout commit (detached)",
      "Create branch here…",
      "Create tag here…",
      "Merge into main…",
      "Rebase main onto this commit…",
      "Cherry-pick into current branch",
      "Revert this commit",
      "Reset current branch to here…",
      "Copy commit id",
    ]);
    expect(m.filter((i) => i.kind === "separator")).toHaveLength(3);
  });

  it("disables detached checkout when already detached there", () => {
    const m = commitMenu({ ...ctx, head: { oid, branch: null, detached: true } });
    expect(find(m, "checkout-commit").disabled).toBe(true);
    expect(find(commitMenu(ctx), "checkout-commit").disabled).toBe(false);
  });

  it("opens dialogs and calls ops", () => {
    const m = commitMenu(ctx);
    find(m, "reset").onSelect();
    expect(useDialogsStore.getState().current).toMatchObject({
      kind: "custom",
      id: "history.reset",
      props: { repoId, target: oid, targetLabel: "aaaaaaa" },
    });
    const revert = vi.fn().mockResolvedValue(true);
    useOpsStore.setState({ revert });
    find(m, "revert").onSelect();
    expect(revert).toHaveBeenCalledWith(repoId, [oid]);
  });
});

describe("refMenu", () => {
  it("local branch: checkout and delete disabled on HEAD", () => {
    const head = refMenu(ctx, ref({ isHead: true }));
    expect(find(head, "checkout").disabled).toBe(true);
    expect(find(head, "delete-branch").disabled).toBe(true);
    expect(find(head, "delete-branch").danger).toBe(true);
    const other = refMenu(ctx, ref({}));
    expect(find(other, "checkout").disabled).toBe(false);
    expect(labels(other)).toEqual(
      expect.arrayContaining(["Rename…", "Set upstream…", "Create branch from here…"]),
    );
  });

  it("remote branch: tracking checkout uses the remote-qualified name", () => {
    const checkout = vi.fn().mockResolvedValue(true);
    useOpsStore.setState({ checkout });
    const m = refMenu(
      ctx,
      ref({
        name: "feat",
        kind: { remoteBranch: { remote: "origin" } },
        fullName: "refs/remotes/origin/feat",
      }),
    );
    expect(labels(m)).toEqual([
      "Checkout (create tracking branch)",
      "Create branch from here…",
      "Merge into main…",
      "Rebase main onto this…",
    ]);
    find(m, "checkout").onSelect();
    expect(checkout).toHaveBeenCalledWith(repoId, "origin/feat");
  });

  it("tag: detached checkout and danger delete", () => {
    const m = refMenu(ctx, ref({ name: "v1", kind: { tag: { annotated: false } } }));
    expect(labels(m)).toEqual(["Checkout tag (detached)", "Delete tag"]);
    expect(find(m, "delete-tag").danger).toBe(true);
  });
});

describe("merge and rebase items", () => {
  it("local branch: opens the merge and rebase dialogs, disabled on HEAD", () => {
    const m = refMenu(ctx, ref({}));
    expect(labels(m)).toEqual(
      expect.arrayContaining(["Merge into main…", "Rebase main onto this…"]),
    );
    find(m, "merge").onSelect();
    expect(useDialogsStore.getState().current).toMatchObject({
      id: "merge.merge",
      props: { repoId, source: "feat", sourceLabel: "feat", current: "main" },
    });
    find(m, "rebase").onSelect();
    expect(useDialogsStore.getState().current).toMatchObject({
      id: "merge.rebase",
      props: { repoId, onto: "feat", ontoLabel: "feat", current: "main" },
    });
    const onHead = refMenu(ctx, ref({ isHead: true }));
    expect(find(onHead, "merge").disabled).toBe(true);
    expect(find(onHead, "rebase").disabled).toBe(true);
  });

  it("detached HEAD disables rebase but not merge", () => {
    const detached = { ...ctx, head: { oid: "b".repeat(40), branch: null, detached: true } };
    const m = refMenu(detached, ref({}));
    expect(find(m, "merge").label).toBe("Merge into HEAD…");
    expect(find(m, "merge").disabled).toBe(false);
    expect(find(m, "rebase").disabled).toBe(true);
  });

  it("commit row: merge and rebase by oid", () => {
    const m = commitMenu(ctx);
    find(m, "merge").onSelect();
    expect(useDialogsStore.getState().current).toMatchObject({
      id: "merge.merge",
      props: { source: oid, sourceLabel: "aaaaaaa" },
    });
    find(m, "rebase").onSelect();
    expect(useDialogsStore.getState().current).toMatchObject({
      id: "merge.rebase",
      props: { onto: oid, ontoLabel: "aaaaaaa" },
    });
  });
});

describe("wipMenu", () => {
  it("stages, unstages, stashes and discards via the stores", () => {
    const stageAll = vi.fn().mockResolvedValue(undefined);
    const unstageAll = vi.fn().mockResolvedValue(undefined);
    const discard = vi.fn().mockResolvedValue(true);
    useWipStore.setState({ stageAll, unstageAll, discard });
    const entries = [
      {
        path: "a.txt",
        origPath: null,
        staged: "unmodified" as const,
        unstaged: "modified" as const,
        conflicted: false,
        submodule: false,
      },
    ];
    const m = wipMenu(repoId, entries);
    expect(labels(m)).toEqual([
      "Stage all",
      "Unstage all",
      "Stash changes…",
      "Discard all changes",
    ]);
    find(m, "stage-all").onSelect();
    find(m, "unstage-all").onSelect();
    expect(stageAll).toHaveBeenCalledWith(repoId);
    expect(unstageAll).toHaveBeenCalledWith(repoId);
    find(m, "stash").onSelect();
    expect(useDialogsStore.getState().current).toMatchObject({ id: "stash.push" });
    expect(find(m, "discard-all").danger).toBe(true);
    find(m, "discard-all").onSelect();
    expect(discard).toHaveBeenCalledTimes(1);
    expect(discard.mock.calls[0]![1]).toHaveLength(1);
  });
});

describe("while an operation is in progress", () => {
  const busyCtx: MenuContext = { ...ctx, inProgress: true };
  const disabledIds = (m: MenuItem[]): string[] =>
    items(m)
      .filter((i) => i.disabled === true)
      .map((i) => i.id);

  it("disables history-changing commit items", () => {
    const d = disabledIds(commitMenu(busyCtx));
    for (const id of [
      "checkout-commit",
      "create-branch",
      "merge",
      "rebase",
      "cherry-pick",
      "revert",
      "reset",
    ]) {
      expect(d).toContain(id);
    }
    expect(d).not.toContain("copy-id");
    expect(d).not.toContain("create-tag");
  });

  it("disables checkout, create branch, merge and rebase on branch chips", () => {
    const d = disabledIds(refMenu(busyCtx, ref({})));
    for (const id of ["checkout", "create-branch", "merge", "rebase"]) expect(d).toContain(id);
    expect(
      disabledIds(
        refMenu(busyCtx, ref({ name: "origin/x", kind: { remoteBranch: { remote: "origin" } } })),
      ),
    ).toContain("checkout");
  });

  it("disables stash and discard all on the working tree row", () => {
    const d = disabledIds(wipMenu(repoId, [], true));
    expect(d).toEqual(["stash", "discard-all"]);
  });
});
