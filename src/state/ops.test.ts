import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ipc/branch", () => ({
  createBranch: vi.fn(),
  checkout: vi.fn(),
  renameBranch: vi.fn(),
  deleteBranch: vi.fn(),
  setUpstream: vi.fn(),
}));
vi.mock("../ipc/history", () => ({ reset: vi.fn(), revert: vi.fn(), cherryPick: vi.fn() }));
vi.mock("../ipc/stash", () => ({
  stashPush: vi.fn(),
  stashApply: vi.fn(),
  stashPop: vi.fn(),
  stashDrop: vi.fn(),
}));
vi.mock("../ipc/merge", () => ({
  merge: vi.fn(),
  rebase: vi.fn(),
  rebaseInteractive: vi.fn(),
  opAbort: vi.fn(),
  opContinue: vi.fn(),
  opSkip: vi.fn(),
}));
vi.mock("../ipc/conflict", () => ({
  takeSide: vi.fn(),
  markResolved: vi.fn(),
  openInEditor: vi.fn(),
}));
vi.mock("../ipc/reflog", () => ({
  undoLast: vi.fn(),
  undoPreview: vi.fn(),
  applyAction: vi.fn(),
}));
vi.mock("../ipc/tag", () => ({ createTag: vi.fn(), deleteTag: vi.fn() }));
vi.mock("./dialogs", () => ({ confirm: vi.fn() }));

import * as branch from "../ipc/branch";
import { IpcError } from "../ipc/core";
import * as conflict from "../ipc/conflict";
import * as history from "../ipc/history";
import * as mergeIpc from "../ipc/merge";
import * as reflog from "../ipc/reflog";
import * as stash from "../ipc/stash";
import type { RepoId } from "../ipc/types";
import { confirm } from "./dialogs";
import { EMPTY_GRAPH, useGraphStore } from "./graph";
import { CONFLICT_TITLE, useOpsStore } from "./ops";
import { useUiStore } from "./ui";

const id = "r1" as RepoId;
const ops = (): ReturnType<typeof useOpsStore.getState> => useOpsStore.getState();
const toasts = (): { kind: string; title: string }[] => useUiStore.getState().toasts;
const err = (code: string): IpcError => new IpcError({ code, message: code });

type ConfirmSpec = Parameters<typeof confirm>[0];

const entry = { index: 0, oid: "o0", branch: null, message: "m", time: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  useOpsStore.setState({ busy: false, redo: {} });
  useUiStore.setState({ toasts: [] });
  // Behave like the real dialog: run onConfirm, resolve true.
  vi.mocked(confirm).mockImplementation(async (spec: ConfirmSpec) => {
    await spec.onConfirm();
    return true;
  });
});

describe("ops store", () => {
  it("deleteBranch retries with force after confirming on branch.not_merged", async () => {
    vi.mocked(branch.deleteBranch)
      .mockRejectedValueOnce(err("branch.not_merged"))
      .mockResolvedValueOnce({ name: "feat", tip: "abcdef1234567890abcdef1234567890abcdef12" });
    const ok = await ops().deleteBranch(id, "feat");
    expect(ok).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
    const spec = vi.mocked(confirm).mock.calls[1]![0];
    expect(spec.danger).toBe(true);
    expect(spec.command).toBe("git branch -D feat");
    expect(branch.deleteBranch).toHaveBeenNthCalledWith(1, id, "feat", false);
    expect(branch.deleteBranch).toHaveBeenNthCalledWith(2, id, "feat", true);
    expect(toasts().at(-1)?.title).toBe("Branch deleted (tip abcdef1)");
  });

  it("deleteBranch confirms the safe delete first (not danger)", async () => {
    vi.mocked(branch.deleteBranch).mockResolvedValue({ name: "feat", tip: "1234567890" });
    expect(await ops().deleteBranch(id, "feat")).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    const spec = vi.mocked(confirm).mock.calls[0]![0];
    expect(spec.danger).toBeUndefined();
    expect(spec.command).toBe("git branch -d feat");
  });

  it("deleteBranch does nothing when the safe confirm is cancelled", async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    expect(await ops().deleteBranch(id, "feat")).toBe(false);
    expect(branch.deleteBranch).not.toHaveBeenCalled();
  });

  it("ignores a second call while the first is pending", async () => {
    let release: () => void = () => undefined;
    vi.mocked(history.revert).mockReturnValue(
      new Promise<undefined>((r) => {
        release = () => r(undefined);
      }),
    );
    const first = ops().revert(id, ["a"]);
    expect(ops().busy).toBe(true);
    expect(await ops().revert(id, ["b"])).toBe(false);
    expect(await ops().deleteBranch(id, "x")).toBe(false);
    expect(await ops().stashDrop(id, entry)).toBe(false);
    expect(history.revert).toHaveBeenCalledTimes(1);
    expect(branch.deleteBranch).not.toHaveBeenCalled();
    release();
    expect(await first).toBe(true);
    expect(ops().busy).toBe(false);
  });

  it("reset always confirms; danger only for hard", async () => {
    vi.mocked(history.reset).mockResolvedValue(undefined);
    const oid = "c".repeat(40);
    await ops().reset(id, oid, "soft");
    await ops().reset(id, oid, "hard");
    const [soft, hard] = vi.mocked(confirm).mock.calls.map((c) => c[0]);
    expect(soft?.danger).toBe(false);
    expect(hard?.danger).toBe(true);
    expect(hard?.command).toBe("git reset --hard ccccccc");
    expect(history.reset).toHaveBeenCalledWith(id, oid, "hard");
  });

  it("reset does not run git when the confirm is cancelled", async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    expect(await ops().reset(id, "d".repeat(40), "mixed")).toBe(false);
    expect(history.reset).not.toHaveBeenCalled();
  });

  it("shows the conflict toast on git.conflict", async () => {
    vi.mocked(stash.stashPop).mockRejectedValue(err("git.conflict"));
    expect(await ops().stashPop(id, entry)).toBe(true);
    expect(toasts().at(-1)).toMatchObject({ kind: "error", title: CONFLICT_TITLE });
    expect(ops().busy).toBe(false);
  });

  it("reports other errors with a title and toasts success", async () => {
    vi.mocked(history.revert).mockRejectedValueOnce(err("git.failed"));
    expect(await ops().revert(id, ["a"])).toBe(false);
    expect(toasts().at(-1)?.title).toBe("Revert failed");
    vi.mocked(history.revert).mockResolvedValueOnce(undefined);
    expect(await ops().revert(id, ["a"])).toBe(true);
    expect(toasts().at(-1)?.title).toBe("Reverted 1 commit");
  });

  it("stashDrop confirms with the stash ref", async () => {
    vi.mocked(stash.stashDrop).mockResolvedValue(undefined);
    await ops().stashDrop(id, { ...entry, index: 2, oid: "o2" });
    expect(vi.mocked(confirm).mock.calls[0]![0].command).toBe("git stash drop stash@{2}");
    expect(stash.stashDrop).toHaveBeenCalledWith(id, 2, "o2");
  });

  it("stash apply/pop pass the oid; git.not_found toasts that the list changed", async () => {
    vi.mocked(stash.stashApply).mockResolvedValue(undefined);
    expect(await ops().stashApply(id, entry)).toBe(true);
    expect(stash.stashApply).toHaveBeenCalledWith(id, 0, "o0", false);
    vi.mocked(stash.stashPop).mockRejectedValue(err("git.not_found"));
    expect(await ops().stashPop(id, entry, true)).toBe(false);
    expect(stash.stashPop).toHaveBeenCalledWith(id, 0, "o0", true);
    expect(toasts().at(-1)).toMatchObject({
      kind: "info",
      title: "Stash list changed, nothing done",
    });
    vi.mocked(stash.stashDrop).mockRejectedValue(err("git.not_found"));
    expect(await ops().stashDrop(id, entry)).toBe(false);
    expect(toasts().at(-1)?.title).toBe("Stash list changed, nothing done");
  });

  it("quotes paths with spaces in command previews", async () => {
    await ops().takeSide(id, ["a b.ts", "c.ts"], "ours");
    expect(vi.mocked(confirm).mock.calls[0]![0].command).toBe(
      'git checkout --ours -- "a b.ts" c.ts',
    );
  });
});

describe("merge, rebase and undo", () => {
  it.each([
    ["fastForward", "Fast-forwarded to feat"],
    ["merged", "Merged feat"],
    ["squashed", "Squashed feat — commit when ready"],
    ["alreadyUpToDate", "Already up to date"],
  ] as const)("merge toast for %s", async (outcome, title) => {
    vi.mocked(mergeIpc.merge).mockResolvedValue(outcome);
    expect(await ops().merge(id, "feat", "default")).toBe(true);
    expect(mergeIpc.merge).toHaveBeenCalledWith(id, {
      source: "feat",
      mode: "default",
      message: null,
    });
    expect(toasts().at(-1)).toMatchObject({ kind: "success", title });
  });

  it("merge conflict shows the conflict toast and resolves true (the banner takes over)", async () => {
    vi.mocked(mergeIpc.merge).mockRejectedValue(err("git.conflict"));
    expect(await ops().merge(id, "feat", "squash")).toBe(true);
    expect(toasts().at(-1)?.title).toBe(CONFLICT_TITLE);
  });

  it("undoLast always confirms and shows the command", async () => {
    vi.mocked(reflog.undoLast).mockResolvedValue({
      info: { label: "commit: x", action: { kind: "resetSoft", target: "a".repeat(40) } },
      redo: { kind: "resetSoft", target: "c".repeat(40) },
      head: "b".repeat(40),
      branch: "main",
    });
    const info = {
      label: "commit: x",
      action: { kind: "resetSoft" as const, target: "a".repeat(40) },
    };
    vi.mocked(reflog.undoPreview).mockResolvedValue(info);
    expect(await ops().undoLast(id, info)).toBe(true);
    const spec = vi.mocked(confirm).mock.calls[0]![0];
    expect(spec.message).toBe("commit: x");
    expect(spec.command).toBe("git reset --soft aaaaaaa");
    expect(reflog.undoLast).toHaveBeenCalledWith(id);
    const co = { label: "l", action: { kind: "checkout" as const, target: "main", detach: false } };
    vi.mocked(reflog.undoPreview).mockResolvedValue(co);
    await ops().undoLast(id, co);
    expect(vi.mocked(confirm).mock.calls[1]![0].command).toBe("git switch main");
  });

  it("undoLast stores a redo target, a head move clears it, redoLast applies and clears", async () => {
    const info = {
      label: "commit: x",
      action: { kind: "resetSoft" as const, target: "a".repeat(40) },
    };
    const redo = { kind: "resetSoft" as const, target: "c".repeat(40) };
    const head = "b".repeat(40);
    vi.mocked(reflog.undoLast).mockResolvedValue({ info, redo, head, branch: "main" });
    vi.mocked(reflog.undoPreview).mockResolvedValue(info);
    const withHead = (oid: string, branch: string | null = "main"): void =>
      useGraphStore.setState({
        byRepo: {
          [id]: {
            ...EMPTY_GRAPH,
            refs: { head: { oid, branch, detached: branch === null }, refs: [] },
          },
        },
      });
    withHead("a".repeat(40));
    expect(await ops().undoLast(id, info)).toBe(true);
    expect(ops().redo[id]).toEqual({ action: redo, head, branch: "main" });
    withHead(head);
    expect(ops().redo[id]).toBeDefined();
    withHead("d".repeat(40));
    expect(ops().redo[id]).toBeUndefined();

    // Same commit, different branch: also cleared.
    useOpsStore.setState({ redo: { [id]: { action: redo, head, branch: "main" } } });
    withHead(head, "other");
    expect(ops().redo[id]).toBeUndefined();

    useOpsStore.setState({ redo: { [id]: { action: redo, head, branch: "main" } } });
    expect(await ops().redoLast(id)).toBe(true);
    expect(reflog.applyAction).toHaveBeenCalledWith(id, redo);
    expect(ops().redo[id]).toBeUndefined();
    expect(await ops().redoLast(id)).toBe(false);
  });

  it("undoLast re-checks the target and refuses when it changed", async () => {
    const stored = { label: "a", action: { kind: "resetSoft" as const, target: "a".repeat(40) } };
    const fresh = { label: "b", action: { kind: "resetSoft" as const, target: "b".repeat(40) } };
    useGraphStore.setState({ byRepo: { [id]: { ...EMPTY_GRAPH, undo: stored } } });
    vi.mocked(reflog.undoPreview).mockResolvedValue(fresh);
    expect(await ops().undoLast(id, stored)).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(reflog.undoLast).not.toHaveBeenCalled();
    expect(toasts().at(-1)).toMatchObject({ kind: "info", title: "Undo target changed, refresh" });
    expect(useGraphStore.getState().byRepo[id]!.undo).toEqual(fresh);
    vi.mocked(reflog.undoPreview).mockResolvedValue(null);
    expect(await ops().undoLast(id, fresh)).toBe(false);
    expect(useGraphStore.getState().byRepo[id]!.undo).toBeNull();
  });

  it("merge, rebase, cherry-pick, revert and stash resolve true on conflict", async () => {
    vi.mocked(mergeIpc.merge).mockRejectedValue(err("git.conflict"));
    vi.mocked(mergeIpc.rebase).mockRejectedValue(err("git.conflict"));
    vi.mocked(mergeIpc.rebaseInteractive).mockRejectedValue(err("git.conflict"));
    vi.mocked(history.cherryPick).mockRejectedValue(err("git.conflict"));
    vi.mocked(history.revert).mockRejectedValue(err("git.conflict"));
    vi.mocked(stash.stashApply).mockRejectedValue(err("git.conflict"));
    vi.mocked(stash.stashPop).mockRejectedValue(err("git.conflict"));
    expect(await ops().merge(id, "f", "default")).toBe(true);
    expect(await ops().rebase(id, "f")).toBe(true);
    expect(await ops().rebaseInteractive(id, "f", [])).toBe(true);
    expect(await ops().cherryPick(id, ["a"])).toBe(true);
    expect(await ops().revert(id, ["a"])).toBe(true);
    expect(await ops().stashApply(id, entry)).toBe(true);
    expect(await ops().stashPop(id, entry)).toBe(true);
    expect(toasts().at(-1)?.title).toBe(CONFLICT_TITLE);
    vi.mocked(mergeIpc.merge).mockRejectedValue(err("git.failed"));
    expect(await ops().merge(id, "f", "default")).toBe(false);
  });

  it("opAbort and opSkip confirm; opContinue does not", async () => {
    await ops().opAbort(id, "cherryPick");
    expect(vi.mocked(confirm).mock.calls[0]![0]).toMatchObject({
      danger: true,
      command: "git cherry-pick --abort",
    });
    expect(mergeIpc.opAbort).toHaveBeenCalledWith(id, "cherryPick");
    await ops().opSkip(id, "rebase");
    expect(vi.mocked(confirm).mock.calls[1]![0].command).toBe("git rebase --skip");
    await ops().opContinue(id, "rebase");
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(mergeIpc.opContinue).toHaveBeenCalledWith(id, "rebase");
  });

  it("takeSide confirms only for several paths", async () => {
    await ops().takeSide(id, ["a"], "ours");
    expect(confirm).not.toHaveBeenCalled();
    expect(conflict.takeSide).toHaveBeenCalledWith(id, ["a"], "ours");
    await ops().takeSide(id, ["a", "b"], "theirs");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(conflict.takeSide).toHaveBeenLastCalledWith(id, ["a", "b"], "theirs");
  });
});
