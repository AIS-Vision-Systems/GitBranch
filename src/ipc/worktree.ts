import { call } from "./core";
import type { RepoId } from "./types";

export interface Worktree {
  path: string;
  headOid: string | null;
  branch: string | null;
  isMain: boolean;
  isBare: boolean;
  isDetached: boolean;
  locked: boolean;
  lockReason: string | null;
  prunable: boolean;
  pruneReason: string | null;
}

export type WorktreeCheckout =
  | { kind: "existing"; branch: string }
  | { kind: "new"; branch: string; startPoint: string }
  | { kind: "detached"; revision: string };

export async function listWorktrees(repoId: RepoId): Promise<Worktree[]> {
  return call<Worktree[]>("list_worktrees", { repoId });
}

export async function addWorktree(
  repoId: RepoId,
  path: string,
  checkout: WorktreeCheckout,
  force: boolean,
): Promise<void> {
  return call<void>("add_worktree", { repoId, path, checkout, force });
}

/** Returns the ids of open repositories that lived in the removed worktree (now closed). */
export async function removeWorktree(
  repoId: RepoId,
  path: string,
  force: boolean,
): Promise<string[]> {
  return call<string[]>("remove_worktree", { repoId, path, force });
}

export async function pruneWorktrees(repoId: RepoId): Promise<void> {
  return call<void>("prune_worktrees", { repoId });
}

export async function lockWorktree(
  repoId: RepoId,
  path: string,
  reason: string | null,
): Promise<void> {
  return call<void>("lock_worktree", { repoId, path, reason });
}

export async function unlockWorktree(repoId: RepoId, path: string): Promise<void> {
  return call<void>("unlock_worktree", { repoId, path });
}

export async function defaultWorktreePath(repoId: RepoId, branch: string): Promise<string> {
  return call<string>("default_worktree_path", { repoId, branch });
}
