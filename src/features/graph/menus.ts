import {
  openCreateBranch,
  openCreateTag,
  openMerge,
  openRebase,
  openReset,
  openRenameBranch,
  openSetUpstream,
  openStashPush,
} from "../dialogs/open";
import type { Commit, Head, Ref, RepoId, StatusEntry } from "../../ipc/types";
import { shortOid, useOpsStore } from "../../state/ops";
import { useWipStore } from "../../state/wip";
import { wipItems } from "../commit/items";
import type { MenuItem } from "../shell/ContextMenu";

export interface MenuContext {
  repoId: RepoId;
  commit: Commit;
  /** Refs pointing at `commit`. */
  refs: Ref[];
  head: Head | null;
  /** A merge/rebase/cherry-pick/revert is stopped; history-changing items are disabled. */
  inProgress: boolean;
}

export function remoteTrackingName(ref: Ref): string {
  if (typeof ref.kind === "object" && "remoteBranch" in ref.kind) {
    const remote = ref.kind.remoteBranch.remote;
    return ref.name.startsWith(`${remote}/`) ? ref.name : `${remote}/${ref.name}`;
  }
  return ref.name;
}

const SEP: MenuItem = { kind: "separator" };

/** Label for "the current branch" in merge/rebase items. */
function currentLabel(head: Head | null): string {
  return head?.branch ?? "HEAD";
}

/** Merge and rebase items for a source (ref name or oid). `isHead` disables both. */
function integrateItems(
  ctx: MenuContext,
  source: string,
  label: string,
  isHead: boolean,
  what: string,
): MenuItem[] {
  const cur = currentLabel(ctx.head);
  const detached = ctx.head === null || ctx.head.detached;
  return [
    {
      kind: "item",
      id: "merge",
      label: `Merge into ${cur}…`,
      disabled: ctx.inProgress || isHead || ctx.head === null,
      onSelect: () => openMerge(ctx.repoId, source, label, cur),
    },
    {
      kind: "item",
      id: "rebase",
      label: `Rebase ${cur} onto ${what}…`,
      disabled: ctx.inProgress || isHead || detached,
      onSelect: () => openRebase(ctx.repoId, source, label, cur),
    },
  ];
}

function copyId(oid: string): void {
  try {
    void navigator.clipboard?.writeText(oid)?.catch(() => undefined);
  } catch {
    // Clipboard unavailable: silent by design.
  }
}

export function commitMenu(ctx: MenuContext): MenuItem[] {
  const { repoId, commit } = ctx;
  const oid = commit.oid;
  const short = shortOid(oid);
  const ops = (): ReturnType<typeof useOpsStore.getState> => useOpsStore.getState();
  return [
    {
      kind: "item",
      id: "checkout-commit",
      label: "Checkout commit (detached)",
      disabled: ctx.inProgress || (ctx.head?.detached === true && ctx.head.oid === oid),
      onSelect: () => void ops().checkout(repoId, oid, true),
    },
    {
      kind: "item",
      id: "create-branch",
      label: "Create branch here…",
      disabled: ctx.inProgress,
      onSelect: () => openCreateBranch(repoId, oid, short),
    },
    {
      kind: "item",
      id: "create-tag",
      label: "Create tag here…",
      onSelect: () => openCreateTag(repoId, oid, short),
    },
    SEP,
    ...integrateItems(ctx, oid, short, ctx.head?.oid === oid, "this commit"),
    {
      kind: "item",
      id: "cherry-pick",
      label: "Cherry-pick into current branch",
      disabled: ctx.inProgress,
      onSelect: () => void ops().cherryPick(repoId, [oid]),
    },
    {
      kind: "item",
      id: "revert",
      label: "Revert this commit",
      disabled: ctx.inProgress,
      onSelect: () => void ops().revert(repoId, [oid]),
    },
    SEP,
    {
      kind: "item",
      id: "reset",
      label: "Reset current branch to here…",
      disabled: ctx.inProgress,
      onSelect: () => openReset(repoId, oid, short),
    },
    SEP,
    { kind: "item", id: "copy-id", label: "Copy commit id", onSelect: () => copyId(oid) },
  ];
}

export function refMenu(ctx: MenuContext, ref: Ref): MenuItem[] {
  const { repoId } = ctx;
  const ops = (): ReturnType<typeof useOpsStore.getState> => useOpsStore.getState();
  const from = (name: string): MenuItem => ({
    kind: "item",
    id: "create-branch",
    label: "Create branch from here…",
    disabled: ctx.inProgress,
    onSelect: () => openCreateBranch(repoId, ref.target, name),
  });
  if (ref.kind === "localBranch") {
    return [
      {
        kind: "item",
        id: "checkout",
        label: "Checkout",
        disabled: ctx.inProgress || ref.isHead,
        onSelect: () => void ops().checkout(repoId, ref.name),
      },
      from(ref.name),
      SEP,
      ...integrateItems(ctx, ref.name, ref.name, ref.isHead, "this"),
      SEP,
      {
        kind: "item",
        id: "rename",
        label: "Rename…",
        onSelect: () => openRenameBranch(repoId, ref.name),
      },
      {
        kind: "item",
        id: "set-upstream",
        label: "Set upstream…",
        onSelect: () => openSetUpstream(repoId, ref.name, ref.upstream?.name ?? null),
      },
      SEP,
      {
        kind: "item",
        id: "delete-branch",
        label: "Delete branch",
        danger: true,
        disabled: ref.isHead,
        onSelect: () => void ops().deleteBranch(repoId, ref.name),
      },
    ];
  }
  if (typeof ref.kind === "object" && "remoteBranch" in ref.kind) {
    const full = remoteTrackingName(ref);
    return [
      {
        kind: "item",
        id: "checkout",
        label: "Checkout (create tracking branch)",
        disabled: ctx.inProgress,
        onSelect: () => void ops().checkout(repoId, full),
      },
      from(full),
      SEP,
      ...integrateItems(ctx, full, full, false, "this"),
    ];
  }
  return [
    {
      kind: "item",
      id: "checkout",
      label: "Checkout tag (detached)",
      disabled: ctx.inProgress,
      onSelect: () => void ops().checkout(repoId, ref.name, true),
    },
    {
      kind: "item",
      id: "delete-tag",
      label: "Delete tag",
      danger: true,
      onSelect: () => void ops().deleteTag(repoId, ref.name),
    },
  ];
}

/** Context menu of the synthetic working-tree row. */
export function wipMenu(repoId: RepoId, entries: StatusEntry[], inProgress = false): MenuItem[] {
  const wip = (): ReturnType<typeof useWipStore.getState> => useWipStore.getState();
  return [
    {
      kind: "item",
      id: "stage-all",
      label: "Stage all",
      onSelect: () => void wip().stageAll(repoId),
    },
    {
      kind: "item",
      id: "unstage-all",
      label: "Unstage all",
      onSelect: () => void wip().unstageAll(repoId),
    },
    {
      kind: "item",
      id: "stash",
      label: "Stash changes…",
      disabled: inProgress,
      onSelect: () => openStashPush(repoId),
    },
    SEP,
    {
      kind: "item",
      id: "discard-all",
      label: "Discard all changes",
      danger: true,
      disabled: inProgress,
      onSelect: () =>
        void wip().discard(
          repoId,
          wipItems(entries).filter((i) => i.target.kind !== "staged" && i.conflicted !== true),
        ),
    },
  ];
}
