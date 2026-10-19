import { call } from "./core";
import type { RepoId } from "./types";

export type ResetMode = "soft" | "mixed" | "hard";

export function reset(repoId: RepoId, target: string, mode: ResetMode): Promise<void> {
  return call<void>("reset", { repoId, target, mode });
}

export function revert(repoId: RepoId, oids: string[], noCommit: boolean): Promise<void> {
  return call<void>("revert", { repoId, oids, noCommit });
}

export function cherryPick(repoId: RepoId, oids: string[], noCommit: boolean): Promise<void> {
  return call<void>("cherry_pick", { repoId, oids, noCommit });
}

export interface RangeCommit {
  oid: string;
  subject: string;
  body: string;
}

/** Commits reachable from `head` but not `base` (at most `limit`). */
export const commitsBetween = (
  repoId: RepoId,
  base: string,
  head: string,
  limit: number,
): Promise<RangeCommit[]> => call("commits_between", { repoId, base, head, limit });
