import { useDialogsStore } from "../../state/dialogs";
import type { RepoId } from "../../ipc/types";
import { DIALOG } from "./ids";

/** What a branch was dropped on: a local branch, a remote-tracking branch, or a commit (oid or tag). */
export type DropTargetKind = "local" | "remote" | "commit";

const open = (id: string, props: Record<string, unknown>): void =>
  useDialogsStore.getState().open({ kind: "custom", id, props });

export const openCreateBranch = (repoId: RepoId, startPoint: string, startLabel: string): void =>
  open(DIALOG.createBranch, { repoId, startPoint, startLabel });

export const openRenameBranch = (repoId: RepoId, name: string): void =>
  open(DIALOG.renameBranch, { repoId, name });

export const openSetUpstream = (repoId: RepoId, branch: string, current: string | null): void =>
  open(DIALOG.setUpstream, { repoId, branch, current });

export const openStashPush = (repoId: RepoId): void => open(DIALOG.stashPush, { repoId });

export const openCreateTag = (repoId: RepoId, target: string, targetLabel: string): void =>
  open(DIALOG.createTag, { repoId, target, targetLabel });

export const openReset = (repoId: RepoId, target: string, targetLabel: string): void =>
  open(DIALOG.reset, { repoId, target, targetLabel });

export const openMerge = (
  repoId: RepoId,
  source: string,
  sourceLabel: string,
  current: string,
): void => open(DIALOG.merge, { repoId, source, sourceLabel, current });

export const openRebase = (
  repoId: RepoId,
  onto: string,
  ontoLabel: string,
  current: string,
): void => open(DIALOG.rebase, { repoId, onto, ontoLabel, current });

export const openBranchDrop = (
  repoId: RepoId,
  source: string,
  target: string,
  targetLabel: string,
  targetKind: DropTargetKind,
): void => open(DIALOG.branchDrop, { repoId, source, target, targetLabel, targetKind });
