import { call } from "./core";
import type { RepoId } from "./types";

export interface StashEntry {
  index: number;
  oid: string;
  branch: string | null;
  message: string;
  /** Base commit oid. */
  base: string;
  authorName: string;
  authorEmail: string;
  /** Unix seconds. */
  time: number;
}

export interface StashPushArgs {
  message: string | null;
  includeUntracked: boolean;
  keepIndex: boolean;
  paths: string[];
}

export function stashList(repoId: RepoId): Promise<StashEntry[]> {
  return call<StashEntry[]>("stash_list", { repoId });
}

export function stashPush(repoId: RepoId, args: StashPushArgs): Promise<void> {
  return call<void>("stash_push", { repoId, args });
}

export function stashApply(
  repoId: RepoId,
  index: number,
  oid: string,
  restoreIndex: boolean,
): Promise<void> {
  return call<void>("stash_apply", { repoId, index, oid, restoreIndex });
}

export function stashPop(
  repoId: RepoId,
  index: number,
  oid: string,
  restoreIndex: boolean,
): Promise<void> {
  return call<void>("stash_pop", { repoId, index, oid, restoreIndex });
}

export function stashDrop(repoId: RepoId, index: number, oid: string): Promise<void> {
  return call<void>("stash_drop", { repoId, index, oid });
}
