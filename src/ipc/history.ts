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
