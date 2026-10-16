import { call } from "./core";
import type { RepoId } from "./types";

export interface DeletedBranch {
  name: string;
  tip: string;
}

export function createBranch(
  repoId: RepoId,
  name: string,
  startPoint: string,
  checkout: boolean,
): Promise<void> {
  return call<void>("create_branch", { repoId, name, startPoint, checkout });
}

export function checkout(repoId: RepoId, target: string, detach: boolean): Promise<void> {
  return call<void>("checkout", { repoId, target, detach });
}

export function renameBranch(repoId: RepoId, old: string, name: string): Promise<void> {
  return call<void>("rename_branch", { repoId, old, new: name });
}

export function deleteBranch(repoId: RepoId, name: string, force: boolean): Promise<DeletedBranch> {
  return call<DeletedBranch>("delete_branch", { repoId, name, force });
}

export function setUpstream(
  repoId: RepoId,
  branch: string,
  upstream: string | null,
): Promise<void> {
  return call<void>("set_upstream", { repoId, branch, upstream });
}
