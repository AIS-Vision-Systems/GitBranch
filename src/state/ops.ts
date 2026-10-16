import { create } from "zustand";
import * as branchIpc from "../ipc/branch";
import { isIpcError } from "../ipc/core";
import * as conflictIpc from "../ipc/conflict";
import type { Side } from "../ipc/conflict";
import * as historyIpc from "../ipc/history";
import type { ResetMode } from "../ipc/history";
import * as mergeIpc from "../ipc/merge";
import type { MergeMode, MergeOutcome, OpKind, TodoItem } from "../ipc/merge";
import * as reflogIpc from "../ipc/reflog";
import type { UndoInfo } from "../ipc/reflog";
import * as stashIpc from "../ipc/stash";
import type { StashEntry, StashPushArgs } from "../ipc/stash";
import * as tagIpc from "../ipc/tag";
import type { TagArgs } from "../ipc/tag";
import type { RepoId } from "../ipc/types";
import { quotePath, quotePaths } from "../lib/shellQuote";
import { confirm } from "./dialogs";
import { EMPTY_GRAPH, useGraphStore } from "./graph";
import { reportError, useUiStore } from "./ui";

export const CONFLICT_TITLE = "Conflicts — resolve them in the working tree";

const RESET_HELP: Record<ResetMode, string> = {
  soft: "Moves the current branch to this commit and keeps all changes staged.",
  mixed: "Moves the current branch to this commit and keeps changes in the working tree, unstaged.",
  hard: "Moves the current branch to this commit and discards all uncommitted changes.",
};

export function shortOid(s: string): string {
  return /^[0-9a-f]{40,64}$/.test(s) ? s.slice(0, 7) : s;
}

const OP_NAME: Record<OpKind, string> = {
  merge: "merge",
  rebase: "rebase",
  cherryPick: "cherry-pick",
  revert: "revert",
};

export function opTitle(kind: OpKind): string {
  const n = OP_NAME[kind];
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function mergeToast(outcome: MergeOutcome, source: string): string {
  switch (outcome) {
    case "fastForward":
      return `Fast-forwarded to ${source}`;
    case "merged":
      return `Merged ${source}`;
    case "squashed":
      return `Squashed ${source} — commit when ready`;
    case "alreadyUpToDate":
      return "Already up to date";
  }
}

/** The git command an undo would run, for the confirm dialog and the toolbar tooltip. */
export function undoCommand(info: UndoInfo): string {
  const a = info.action;
  switch (a.kind) {
    case "resetKeep":
      return `git reset --keep ${shortOid(a.target)}`;
    case "resetSoft":
      return `git reset --soft ${shortOid(a.target)}`;
    case "checkout":
      return `git switch ${a.detach ? "--detach " : ""}${quotePath(a.target)}`;
  }
}

type Outcome = "ok" | "conflict" | "error";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function toast(title: string): void {
  useUiStore.getState().pushToast({ kind: "success", title });
}

interface OpsState {
  busy: boolean;
  createBranch: (
    repoId: RepoId,
    name: string,
    startPoint: string,
    checkout: boolean,
  ) => Promise<boolean>;
  checkout: (repoId: RepoId, target: string, detach?: boolean) => Promise<boolean>;
  renameBranch: (repoId: RepoId, old: string, name: string) => Promise<boolean>;
  deleteBranch: (repoId: RepoId, name: string) => Promise<boolean>;
  setUpstream: (repoId: RepoId, branch: string, upstream: string | null) => Promise<boolean>;
  stashPush: (repoId: RepoId, args: StashPushArgs) => Promise<boolean>;
  stashApply: (repoId: RepoId, entry: StashEntry, restoreIndex?: boolean) => Promise<boolean>;
  stashPop: (repoId: RepoId, entry: StashEntry, restoreIndex?: boolean) => Promise<boolean>;
  stashDrop: (repoId: RepoId, entry: StashEntry) => Promise<boolean>;
  reset: (repoId: RepoId, target: string, mode: ResetMode) => Promise<boolean>;
  revert: (repoId: RepoId, oids: string[], noCommit?: boolean) => Promise<boolean>;
  cherryPick: (repoId: RepoId, oids: string[], noCommit?: boolean) => Promise<boolean>;
  createTag: (repoId: RepoId, args: TagArgs) => Promise<boolean>;
  deleteTag: (repoId: RepoId, name: string) => Promise<boolean>;
  merge: (repoId: RepoId, source: string, mode: MergeMode) => Promise<boolean>;
  rebase: (repoId: RepoId, onto: string, branch?: string | null) => Promise<boolean>;
  rebaseInteractive: (repoId: RepoId, onto: string, items: TodoItem[]) => Promise<boolean>;
  opAbort: (repoId: RepoId, kind: OpKind) => Promise<boolean>;
  opContinue: (repoId: RepoId, kind: OpKind) => Promise<boolean>;
  opSkip: (repoId: RepoId, kind: OpKind) => Promise<boolean>;
  takeSide: (repoId: RepoId, paths: string[], side: Side) => Promise<boolean>;
  markResolved: (repoId: RepoId, paths: string[]) => Promise<boolean>;
  openInEditor: (repoId: RepoId, path: string) => Promise<boolean>;
  undoLast: (repoId: RepoId, info: UndoInfo) => Promise<boolean>;
}

export const useOpsStore = create<OpsState>((set, get) => {
  /**
   * Run one backend call: busy flag, error reporting, conflict toast.
   * "conflict" means the operation started and stopped on conflicts (the banner takes over).
   */
  const runOutcome = async (
    failTitle: string,
    fn: () => Promise<unknown>,
    done?: string,
    handled?: (e: unknown) => boolean,
  ): Promise<Outcome> => {
    if (get().busy) return "error";
    set({ busy: true });
    try {
      await fn();
    } catch (e) {
      if (handled?.(e) === true) {
        return "error";
      }
      if (isIpcError(e) && e.error.code === "git.conflict") {
        useUiStore.getState().pushToast({
          kind: "error",
          title: CONFLICT_TITLE,
          ...(e.error.detail !== undefined ? { detail: e.error.detail } : {}),
        });
        return "conflict";
      }
      reportError(e, failTitle);
      return "error";
    } finally {
      set({ busy: false });
    }
    if (done !== undefined) toast(done);
    return "ok";
  };

  /** Resolves true on success only. */
  const run = async (
    failTitle: string,
    fn: () => Promise<unknown>,
    done?: string,
    handled?: (e: unknown) => boolean,
  ): Promise<boolean> => (await runOutcome(failTitle, fn, done, handled)) === "ok";

  /** Resolves true when the operation started: success or stopped on conflicts. */
  const runStarted = async (
    failTitle: string,
    fn: () => Promise<unknown>,
    done?: string,
    handled?: (e: unknown) => boolean,
  ): Promise<boolean> => (await runOutcome(failTitle, fn, done, handled)) !== "error";

  /** git.not_found from a stash call: the list moved under us. */
  const stashMoved = (e: unknown): boolean => {
    if (!isIpcError(e) || e.error.code !== "git.not_found") return false;
    useUiStore.getState().pushToast({ kind: "info", title: "Stash list changed, nothing done" });
    return true;
  };

  /** Confirm first; on confirm run `fn`, reporting failures here (the dialog then just closes). */
  const confirmed = async (
    spec: {
      title: string;
      message: string;
      command: string;
      confirmLabel: string;
      danger?: boolean;
    },
    failTitle: string,
    fn: () => Promise<unknown>,
    done?: string,
    handled?: (e: unknown) => boolean,
  ): Promise<boolean> => {
    if (get().busy) return false;
    let ok = false;
    const confirmedByUser = await confirm({
      ...spec,
      onConfirm: async () => {
        ok = await run(failTitle, fn, done, handled);
      },
    });
    return confirmedByUser && ok;
  };

  return {
    busy: false,

    createBranch: (repoId, name, startPoint, checkout) =>
      run("Create branch failed", () => branchIpc.createBranch(repoId, name, startPoint, checkout)),

    checkout: (repoId, target, detach = false) =>
      run("Checkout failed", () => branchIpc.checkout(repoId, target, detach)),

    renameBranch: (repoId, old, name) =>
      run("Rename failed", () => branchIpc.renameBranch(repoId, old, name)),

    deleteBranch: async (repoId, name) => {
      if (get().busy) return false;
      let ok = false;
      let notMerged = false;
      const confirmedByUser = await confirm({
        title: "Delete branch",
        message: `Delete branch ${name}?`,
        command: `git branch -d ${quotePath(name)}`,
        confirmLabel: "Delete",
        onConfirm: async () => {
          if (get().busy) return;
          set({ busy: true });
          try {
            const d = await branchIpc.deleteBranch(repoId, name, false);
            toast(`Branch deleted (tip ${shortOid(d.tip)})`);
            ok = true;
          } catch (e) {
            if (isIpcError(e) && e.error.code === "branch.not_merged") notMerged = true;
            else reportError(e, "Delete branch failed");
          } finally {
            set({ busy: false });
          }
        },
      });
      if (!confirmedByUser) return false;
      if (!notMerged) return ok;
      return confirmed(
        {
          title: "Delete branch",
          message: "Branch is not fully merged. Delete anyway?",
          command: `git branch -D ${quotePath(name)}`,
          confirmLabel: "Delete",
          danger: true,
        },
        "Delete branch failed",
        async () => {
          const d = await branchIpc.deleteBranch(repoId, name, true);
          toast(`Branch deleted (tip ${shortOid(d.tip)})`);
        },
      );
    },

    setUpstream: (repoId, branch, upstream) =>
      run("Set upstream failed", () => branchIpc.setUpstream(repoId, branch, upstream)),

    stashPush: (repoId, args) =>
      run("Stash failed", () => stashIpc.stashPush(repoId, args), "Changes stashed"),

    stashApply: (repoId, e, restoreIndex = false) =>
      runStarted(
        "Apply stash failed",
        () => stashIpc.stashApply(repoId, e.index, e.oid, restoreIndex),
        "Stash applied",
        stashMoved,
      ),

    stashPop: (repoId, e, restoreIndex = false) =>
      runStarted(
        "Pop stash failed",
        () => stashIpc.stashPop(repoId, e.index, e.oid, restoreIndex),
        "Stash popped",
        stashMoved,
      ),

    stashDrop: (repoId, e) =>
      confirmed(
        {
          title: "Drop stash",
          message: `Drop stash@{${e.index}}? Its changes will be lost.`,
          command: `git stash drop stash@{${e.index}}`,
          confirmLabel: "Drop",
          danger: true,
        },
        "Drop stash failed",
        () => stashIpc.stashDrop(repoId, e.index, e.oid),
        "Stash dropped",
        stashMoved,
      ),

    reset: (repoId, target, mode) =>
      confirmed(
        {
          title: `Reset (${mode})`,
          message: RESET_HELP[mode],
          command: `git reset --${mode} ${shortOid(target)}`,
          confirmLabel: "Reset",
          danger: mode === "hard",
        },
        "Reset failed",
        () => historyIpc.reset(repoId, target, mode),
      ),

    revert: (repoId, oids, noCommit = false) =>
      runStarted(
        "Revert failed",
        () => historyIpc.revert(repoId, oids, noCommit),
        `Reverted ${plural(oids.length, "commit")}`,
      ),

    cherryPick: (repoId, oids, noCommit = false) =>
      runStarted(
        "Cherry-pick failed",
        () => historyIpc.cherryPick(repoId, oids, noCommit),
        `Cherry-picked ${plural(oids.length, "commit")}`,
      ),

    createTag: (repoId, args) => run("Create tag failed", () => tagIpc.createTag(repoId, args)),

    deleteTag: (repoId, name) =>
      confirmed(
        {
          title: "Delete tag",
          message: `Delete tag ${name}? Commits are not affected.`,
          command: `git tag -d ${quotePath(name)}`,
          confirmLabel: "Delete",
          danger: true,
        },
        "Delete tag failed",
        () => tagIpc.deleteTag(repoId, name),
      ),

    merge: async (repoId, source, mode) => {
      const res: { outcome: MergeOutcome | null } = { outcome: null };
      const ok = await runStarted("Merge failed", async () => {
        res.outcome = await mergeIpc.merge(repoId, { source, mode, message: null });
      });
      if (ok && res.outcome !== null) toast(mergeToast(res.outcome, shortOid(source)));
      return ok;
    },

    rebase: (repoId, onto, branch = null) =>
      runStarted(
        "Rebase failed",
        () => mergeIpc.rebase(repoId, onto, branch),
        `Rebased onto ${shortOid(onto)}`,
      ),

    rebaseInteractive: (repoId, onto, items) =>
      runStarted(
        "Rebase failed",
        () => mergeIpc.rebaseInteractive(repoId, onto, items),
        `Rebased onto ${shortOid(onto)}`,
      ),

    opAbort: (repoId, kind) =>
      confirmed(
        {
          title: `Abort ${OP_NAME[kind]}`,
          message: `Abort the ${OP_NAME[kind]} and go back to the state before it started?`,
          command: `git ${OP_NAME[kind]} --abort`,
          confirmLabel: "Abort",
          danger: true,
        },
        `Abort ${OP_NAME[kind]} failed`,
        () => mergeIpc.opAbort(repoId, kind),
        `${opTitle(kind)} aborted`,
      ),

    opContinue: (repoId, kind) =>
      run(`Continue ${OP_NAME[kind]} failed`, () => mergeIpc.opContinue(repoId, kind)),

    opSkip: (repoId, kind) =>
      confirmed(
        {
          title: `Skip ${OP_NAME[kind]} step`,
          message: "Skip the current step? Its changes will be dropped.",
          command: `git ${OP_NAME[kind]} --skip`,
          confirmLabel: "Skip",
          danger: true,
        },
        `Skip ${OP_NAME[kind]} failed`,
        () => mergeIpc.opSkip(repoId, kind),
      ),

    takeSide: (repoId, paths, side) => {
      const fn = (): Promise<void> => conflictIpc.takeSide(repoId, paths, side);
      if (paths.length <= 1) return run("Could not resolve the conflict", fn);
      return confirmed(
        {
          title: `Take ${side} for all`,
          message: `Overwrite ${plural(paths.length, "conflicted file")} with the ${side} version?`,
          command: `git checkout --${side} -- ${quotePaths(paths)}`,
          confirmLabel: `Take ${side}`,
          danger: true,
        },
        "Could not resolve the conflicts",
        fn,
      );
    },

    markResolved: (repoId, paths) =>
      run("Could not mark as resolved", () => conflictIpc.markResolved(repoId, paths)),

    openInEditor: (repoId, path) =>
      run("Could not open the editor", () => conflictIpc.openInEditor(repoId, path)),

    undoLast: async (repoId, info) => {
      if (get().busy) return false;
      let fresh: UndoInfo | null;
      try {
        fresh = await reflogIpc.undoPreview(repoId);
      } catch (e) {
        reportError(e, "Undo failed");
        return false;
      }
      if (fresh === null || JSON.stringify(fresh.action) !== JSON.stringify(info.action)) {
        useGraphStore.setState((g) => ({
          byRepo: {
            ...g.byRepo,
            [repoId]: { ...(g.byRepo[repoId] ?? EMPTY_GRAPH), undo: fresh },
          },
        }));
        useUiStore.getState().pushToast({ kind: "info", title: "Undo target changed, refresh" });
        return false;
      }
      return confirmed(
        {
          title: "Undo last operation",
          message: info.label,
          command: undoCommand(info),
          confirmLabel: "Undo",
        },
        "Undo failed",
        () => reflogIpc.undoLast(repoId),
        "Undone",
      );
    },
  };
});
