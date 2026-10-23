import { call } from "./core";
import type { RepoId } from "./types";

export interface Remote {
  name: string;
  fetchUrl: string;
  pushUrl: string | null;
}
export type PullMode = "config" | "ffOnly" | "rebase" | "merge";
/** `remote: null` fetches all remotes. */
export interface FetchArgs {
  remote: string | null;
  prune: boolean;
  tags: boolean;
}
export interface PullArgs {
  remote: string | null;
  branch: string | null;
  mode: PullMode;
}
export interface PullResult {
  changed: boolean;
}
export interface PushArgs {
  remote: string;
  branch: string | null;
  /** Branch name on the remote; null = same as `branch`. */
  remoteBranch?: string | null;
  setUpstream: boolean;
  tags: boolean;
  forceWithLease: boolean;
}
export interface PushedRef {
  flag: string;
  from: string;
  to: string;
  summary: string;
}
export interface PushResult {
  refs: PushedRef[];
}

export function listRemotes(repoId: RepoId): Promise<Remote[]> {
  return call<Remote[]>("list_remotes", { repoId });
}

export function addRemote(repoId: RepoId, name: string, url: string): Promise<void> {
  return call<void>("add_remote", { repoId, name, url });
}

export function removeRemote(repoId: RepoId, name: string): Promise<void> {
  return call<void>("remove_remote", { repoId, name });
}

export function renameRemote(repoId: RepoId, old: string, name: string): Promise<void> {
  return call<void>("rename_remote", { repoId, old, new: name });
}

export function setRemoteUrl(
  repoId: RepoId,
  name: string,
  url: string,
  push: boolean,
): Promise<void> {
  return call<void>("set_remote_url", { repoId, name, url, push });
}

export function fetch(repoId: RepoId, args: FetchArgs, opId: string): Promise<void> {
  return call<void>("fetch", { repoId, args, opId });
}

export function pull(repoId: RepoId, args: PullArgs, opId: string): Promise<PullResult> {
  return call<PullResult>("pull", { repoId, args, opId });
}

export function push(repoId: RepoId, args: PushArgs, opId: string): Promise<PushResult> {
  return call<PushResult>("push", { repoId, args, opId });
}

export function defaultPullMode(repoId: RepoId): Promise<Exclude<PullMode, "config">> {
  return call<Exclude<PullMode, "config">>("default_pull_mode", { repoId });
}
