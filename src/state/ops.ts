import { create } from "zustand";
import * as branchIpc from "../ipc/branch";
import { isIpcError } from "../ipc/core";
import * as cloneIpc from "../ipc/clone";
import type { CloneArgs } from "../ipc/clone";
import * as conflictIpc from "../ipc/conflict";
import type { Side } from "../ipc/conflict";
import * as githubIpc from "../ipc/github";
import type { CheckoutPrArgs } from "../ipc/github";
import * as historyIpc from "../ipc/history";
import type { ResetMode } from "../ipc/history";
import * as mergeIpc from "../ipc/merge";
import type { MergeMode, MergeOutcome, OpKind, TodoItem } from "../ipc/merge";
import { cancelOp } from "../ipc/progress";
import * as remoteIpc from "../ipc/remote";
import type { FetchArgs, PullArgs, PushArgs, PushResult, Remote } from "../ipc/remote";
import * as reflogIpc from "../ipc/reflog";
import type { UndoAction, UndoInfo } from "../ipc/reflog";
import * as stashIpc from "../ipc/stash";
import type { StashEntry, StashPushArgs } from "../ipc/stash";
import * as tagIpc from "../ipc/tag";
import type { TagArgs } from "../ipc/tag";
import type { RepoId } from "../ipc/types";
import { pushSummary } from "../lib/pushTarget";
import { githubHttpsUrlOf } from "../lib/remoteUrl";
import { quotePath, quotePaths } from "../lib/shellQuote";
import { openSshFix } from "../features/dialogs/open";
import { cloneNameFromUrl } from "../features/dialogs/validate";
import { confirm } from "./dialogs";
import { EMPTY_GRAPH, useGraphStore } from "./graph";
import { useReposStore } from "./repos";
import { remotesOf, useRemotesStore } from "./remotes";
import { useProgressStore } from "./progress";
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

/** What "Redo" would apply, valid only while HEAD is still at `head`. */
export interface RedoState {
  action: UndoAction;
  head: string;
  /** Branch HEAD was on after the undo; null when detached. */
  branch: string | null;
}

interface OpsState {
  busy: boolean;
  /** Per-repo redo target, set by `undoLast` and cleared when HEAD moves away from `head`. */
  redo: Record<string, RedoState | undefined>;
  redoLast: (repoId: RepoId) => Promise<boolean>;
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
  clone: (args: CloneArgs) => Promise<string | null>;
  fetch: (repoId: RepoId, args: FetchArgs) => Promise<boolean>;
  /**
   * Silent background fetch + prune of all remotes: no progress bar, no toast. Skipped when the last
   * one for this repo finished less than `minGapMs` ago.
   */
  fetchQuiet: (repoId: RepoId, minGapMs?: number) => Promise<boolean>;
  pull: (repoId: RepoId, args: PullArgs) => Promise<boolean>;
  push: (repoId: RepoId, args: PushArgs) => Promise<boolean>;
  /** Resolves with the local branch name, or null on failure/cancel. */
  checkoutPull: (repoId: RepoId, number: number, args: CheckoutPrArgs) => Promise<string | null>;
  addRemote: (repoId: RepoId, name: string, url: string) => Promise<boolean>;
  removeRemote: (repoId: RepoId, name: string) => Promise<boolean>;
  renameRemote: (repoId: RepoId, old: string, name: string) => Promise<boolean>;
  setRemoteUrl: (repoId: RepoId, name: string, url: string, push: boolean) => Promise<boolean>;
}

/** Default minimum gap between two quiet fetches of the same repo. */
export const QUIET_FETCH_GAP_MS = 60_000;
const lastQuietFetch = new Map<RepoId, number>();

/** True when no quiet fetch of `repoId` finished within the last `gapMs`. */
export function quietFetchDue(
  repoId: RepoId,
  now: number = Date.now(),
  gapMs: number = QUIET_FETCH_GAP_MS,
): boolean {
  const last = lastQuietFetch.get(repoId);
  return last === undefined || now - last >= gapMs;
}

/** The running background fetch, if any. It never sets `busy`; user operations cancel it first. */
let quietOp: { repoId: RepoId; opId: string; done: Promise<void> } | null = null;

/** Cancel a running quiet fetch and wait until it settles, so git never runs two commands on a repo. */
async function yieldToQuiet(): Promise<void> {
  const q = quietOp;
  if (q === null) return;
  try {
    await cancelOp(q.opId);
  } catch {
    // The fetch finishes on its own; we wait for it below either way.
  }
  await q.done;
}

/** Forget the throttle state (tests). */
export function resetQuietFetchThrottle(): void {
  lastQuietFetch.clear();
}

export const AUTH_REQUIRED_TITLE =
  "Authentication required. Sign in to GitHub for HTTPS remotes; SSH remotes use your agent.";
export const SSH_AUTH_TITLE = "SSH key rejected by the remote";
export const SSH_AUTH_HINT =
  "GitBranch runs ssh without a terminal, so it cannot ask for a key passphrase. Fix SSH checks the agent and " +
  "your keys, and can load a key for you.";
export const PUSH_REJECTED_HINT = "Pull first, or push again with --force-with-lease.";

/** git.auth_required: one explanatory toast instead of the raw error. */
function authRequired(e: unknown): boolean {
  if (!isIpcError(e) || e.error.code !== "git.auth_required") return false;
  useUiStore.getState().pushToast({ kind: "error", title: AUTH_REQUIRED_TITLE });
  return true;
}

/**
 * git.ssh_auth: explain why ssh had no key and offer the Fix SSH dialog. `remote` null = every remote of the
 * repo (fetch all); `repoId` "" = clone (no repository yet).
 */
function sshAuth(repoId: RepoId, remote: string | null): (e: unknown) => boolean {
  return (e) => {
    if (!isIpcError(e) || e.error.code !== "git.ssh_auth") return false;
    const raw = e.error.detail ?? e.error.message;
    const names = repoId === "" ? [] : remotesOf(useRemotesStore.getState(), repoId);
    const only = remote ?? (names.length === 1 ? (names[0]?.name ?? null) : null);
    useUiStore.getState().pushToast({
      kind: "error",
      title: SSH_AUTH_TITLE,
      detail: `${SSH_AUTH_HINT}

${raw}`,
      action: {
        label: "Fix SSH…",
        run: () => openSshFix(repoId === "" ? null : repoId, only),
      },
    });
    return true;
  };
}

/** Points a github.com SSH remote (fetch and, when set, push URL) at its HTTPS URL. */
export async function switchToHttps(repoId: RepoId, r: Remote): Promise<boolean> {
  const ops = useOpsStore.getState();
  const fetchUrl = githubHttpsUrlOf(r.fetchUrl);
  if (fetchUrl === null || !(await ops.setRemoteUrl(repoId, r.name, fetchUrl, false))) return false;
  const pushUrl = r.pushUrl === null ? null : githubHttpsUrlOf(r.pushUrl);
  if (pushUrl !== null && !(await ops.setRemoteUrl(repoId, r.name, pushUrl, true))) return false;
  useUiStore.getState().pushToast({
    kind: "success",
    title: `${r.name} now uses HTTPS`,
    detail: `${fetchUrl}
Run the operation again.`,
  });
  return true;
}

function pushRejected(e: unknown): boolean {
  if (!isIpcError(e) || e.error.code !== "git.rejected") return false;
  const detail = e.error.detail ?? e.error.message;
  useUiStore.getState().pushToast({
    kind: "error",
    title: "Push rejected",
    detail: `${detail}
${PUSH_REJECTED_HINT}`,
  });
  return true;
}

/** Wraps `handled` so a user cancel shows an info toast instead of an error. */
function cancelledAs(title: string, next?: (e: unknown) => boolean): (e: unknown) => boolean {
  return (e) => {
    if (isIpcError(e) && e.error.code === "git.cancelled") {
      useUiStore.getState().pushToast({ kind: "info", title: `${title} cancelled` });
      return true;
    }
    return next?.(e) ?? false;
  };
}

export const useOpsStore = create<OpsState>((set, get) => {
  const setRedo = (repoId: string, redo: RedoState | undefined): void =>
    set((s) => ({ redo: { ...s.redo, [repoId]: redo } }));

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
    if (quietOp !== null) {
      await yieldToQuiet();
      if (get().busy) return "error";
    }
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

  /** Progress bar around a network op; skipped entirely when another op is already running. */
  const withProgress = async (
    repoId: RepoId,
    title: string,
    fn: (title: string, opId: string) => Promise<boolean>,
  ): Promise<boolean> => {
    if (get().busy) return false;
    if (quietOp !== null) {
      await yieldToQuiet();
      if (get().busy) return false;
    }
    const opId = crypto.randomUUID();
    useProgressStore.getState().start({ opId, repoId, title });
    try {
      return await fn(title, opId);
    } finally {
      useProgressStore.getState().finish(opId);
    }
  };

  const reloadRemotes = (repoId: RepoId): void => {
    void useRemotesStore.getState().load(repoId);
  };

  return {
    busy: false,
    redo: {},

    clone: async (args) => {
      const name = cloneNameFromUrl(args.dest);
      let path: string | null = null;
      // A clone has no repo yet: repoId is "".
      const ran = await withProgress("" as RepoId, `Cloning ${name}`, (title, opId) =>
        run(
          "Clone failed",
          async () => {
            path = (await cloneIpc.clone(args, opId)).path;
          },
          undefined,
          cancelledAs(title, (e) => authRequired(e) || sshAuth("" as RepoId, null)(e)),
        ),
      );
      if (path === null) {
        if (!ran && get().busy) {
          useUiStore.getState().pushToast({ kind: "error", title: "Another operation is running" });
        }
        return null;
      }
      const opened: string = path;
      if (await useReposStore.getState().openPath(opened)) toast(`Cloned ${name}`);
      return opened;
    },

    fetch: (repoId, args) =>
      withProgress(
        repoId,
        args.remote === null ? "Fetching all remotes" : `Fetching ${args.remote}`,
        (title, opId) =>
          run(
            "Fetch failed",
            () => remoteIpc.fetch(repoId, args, opId),
            "Fetched",
            cancelledAs(title, (e) => authRequired(e) || sshAuth(repoId, args.remote)(e)),
          ),
      ),

    fetchQuiet: async (repoId, minGapMs = QUIET_FETCH_GAP_MS) => {
      const due = (): boolean => quietFetchDue(repoId, Date.now(), minGapMs);
      if (get().busy || quietOp !== null || !due()) return false;
      if (useRemotesStore.getState().byRepo[repoId] === undefined) {
        await useRemotesStore.getState().load(repoId);
      }
      if (remotesOf(useRemotesStore.getState(), repoId).length === 0) return false;
      if (get().busy || quietOp !== null || !due()) return false;
      // Claim the slot now so concurrent callers (tab switches) do not start a second fetch.
      lastQuietFetch.set(repoId, Date.now());
      const opId = crypto.randomUUID();
      const op = { repoId, opId, done: Promise.resolve() };
      quietOp = op;
      const result = (async (): Promise<boolean> => {
        try {
          await remoteIpc.fetch(repoId, { remote: null, prune: true, tags: false }, opId);
          return true;
        } catch (e) {
          // A user operation cancelled us: stay silent.
          if (!(isIpcError(e) && e.error.code === "git.cancelled")) {
            console.warn("Background fetch failed", e);
          }
          return false;
        } finally {
          lastQuietFetch.set(repoId, Date.now());
          if (quietOp === op) quietOp = null;
        }
      })();
      op.done = result.then(() => undefined);
      return result;
    },

    pull: (repoId, args) =>
      withProgress(repoId, "Pulling", async (title, opId) => {
        const res: { changed: boolean | null } = { changed: null };
        const outcome = await runOutcome(
          "Pull failed",
          async () => {
            res.changed = (await remoteIpc.pull(repoId, args, opId)).changed;
          },
          undefined,
          cancelledAs(title, (e) => authRequired(e) || sshAuth(repoId, args.remote)(e)),
        );
        if (outcome === "ok") toast(res.changed === false ? "Already up to date" : "Pulled");
        return outcome !== "error";
      }),

    push: (repoId, args) =>
      withProgress(repoId, `Pushing ${args.branch ?? args.remote}`, async (title, opId) => {
        const res: { value: PushResult | null } = { value: null };
        const ok = await run(
          "Push failed",
          async () => {
            res.value = await remoteIpc.push(repoId, args, opId);
          },
          undefined,
          cancelledAs(
            title,
            (e) => authRequired(e) || sshAuth(repoId, args.remote)(e) || pushRejected(e),
          ),
        );
        if (ok) {
          const summary = res.value === null ? "" : pushSummary(res.value.refs, args.remote);
          useUiStore.getState().pushToast({
            kind: "success",
            title: "Pushed",
            ...(summary !== "" ? { detail: summary } : {}),
          });
        }
        return ok;
      }),

    checkoutPull: async (repoId, number, args) => {
      const res: { branch: string | null } = { branch: null };
      await withProgress(repoId, `Checking out PR #${number}`, (title, opId) =>
        run(
          "Checkout failed",
          async () => {
            res.branch = await githubIpc.githubCheckoutPull(repoId, args, opId);
          },
          undefined,
          cancelledAs(title, authRequired),
        ),
      );
      if (res.branch !== null) toast(`Checked out ${res.branch}`);
      return res.branch;
    },

    addRemote: async (repoId, name, url) => {
      const ok = await run("Add remote failed", () => remoteIpc.addRemote(repoId, name, url));
      if (ok) reloadRemotes(repoId);
      return ok;
    },

    removeRemote: async (repoId, name) => {
      const ok = await confirmed(
        {
          title: "Remove remote",
          message: `Remove remote ${name}? Its remote-tracking branches are deleted locally.`,
          command: `git remote remove ${quotePath(name)}`,
          confirmLabel: "Remove",
          danger: true,
        },
        "Remove remote failed",
        () => remoteIpc.removeRemote(repoId, name),
      );
      if (ok) reloadRemotes(repoId);
      return ok;
    },

    renameRemote: async (repoId, old, name) => {
      const ok = await run("Rename remote failed", () => remoteIpc.renameRemote(repoId, old, name));
      if (ok) reloadRemotes(repoId);
      return ok;
    },

    setRemoteUrl: async (repoId, name, url, push) => {
      const ok = await run("Update remote URL failed", () =>
        remoteIpc.setRemoteUrl(repoId, name, url, push),
      );
      if (ok) reloadRemotes(repoId);
      return ok;
    },

    createBranch: (repoId, name, startPoint, checkout) =>
      run("Create branch failed", () => branchIpc.createBranch(repoId, name, startPoint, checkout)),

    checkout: async (repoId, target, detach = false) => {
      // Snapshot before the checkout: git-core creates the local branch when it is missing, and the
      // watcher may have reloaded the refs by the time the command returns.
      const refs = useGraphStore.getState().byRepo[repoId]?.refs?.refs ?? [];
      const ok = await run("Checkout failed", () => branchIpc.checkout(repoId, target, detach));
      if (!ok || detach) return ok;
      const pullable = (branch: string): boolean => {
        const local = refs.find((r) => r.kind === "localBranch" && r.name === branch);
        if (local === undefined) return false;
        return local.upstream === null || (!local.upstream.gone && local.upstream.ahead === 0);
      };
      const rb = refs.find(
        (r) =>
          typeof r.kind === "object" &&
          "remoteBranch" in r.kind &&
          (r.name.startsWith(`${r.kind.remoteBranch.remote}/`)
            ? r.name
            : `${r.kind.remoteBranch.remote}/${r.name}`) === target,
      );
      if (rb === undefined || typeof rb.kind !== "object" || !("remoteBranch" in rb.kind)) {
        return ok;
      }
      const remote = rb.kind.remoteBranch.remote;
      const branch = target.slice(remote.length + 1);
      if (!refs.some((r) => r.kind === "localBranch" && r.name === branch)) return ok;
      if (!pullable(branch)) {
        useUiStore.getState().pushToast({
          kind: "info",
          title: `${branch} has local commits`,
          detail: "Pull it from the ribbon when ready.",
        });
        return ok;
      }
      return get().pull(repoId, { remote, branch, mode: "config" });
    },

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
        async () => {
          const outcome = await reflogIpc.undoLast(repoId);
          setRedo(repoId, {
            action: outcome.redo,
            head: outcome.head,
            branch: outcome.branch,
          });
        },
        "Undone",
      );
    },

    redoLast: async (repoId) => {
      const redo = get().redo[repoId];
      if (redo === undefined) return false;
      const ok = await run(
        "Redo failed",
        () => reflogIpc.applyAction(repoId, redo.action),
        "Redone",
      );
      if (ok) setRedo(repoId, undefined);
      return ok;
    },
  };
});

// Redo is only valid while HEAD still sits where the undo left it: any other move clears it.
useGraphStore.subscribe((state) => {
  const redo = useOpsStore.getState().redo;
  for (const id of Object.keys(redo)) {
    const r = redo[id];
    if (r === undefined) continue;
    const head = state.byRepo[id]?.refs?.head;
    if (head === undefined) continue;
    if ((head.oid !== null && head.oid !== r.head) || head.branch !== r.branch) {
      useOpsStore.setState((s) => ({ redo: { ...s.redo, [id]: undefined } }));
    }
  }
});
