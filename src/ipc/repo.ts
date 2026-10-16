import { call } from "./core";
import type { OpenedRepo, RecentRepo } from "./types";

export function pickRepoDir(): Promise<string | null> {
  return call<string | null>("pick_repo_dir");
}

export function openRepo(path: string): Promise<OpenedRepo> {
  return call<OpenedRepo>("open_repo", { path });
}

export function listRecent(): Promise<RecentRepo[]> {
  return call<RecentRepo[]>("list_recent");
}

export function removeRecent(path: string): Promise<void> {
  return call<void>("remove_recent", { path });
}

export function closeRepo(repoId: string): Promise<void> {
  return call<void>("close_repo", { repoId });
}
