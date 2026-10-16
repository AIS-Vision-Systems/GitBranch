import { call } from "./core";
import type { RepoId } from "./types";

export type Side = "ours" | "theirs";

export function takeSide(repoId: RepoId, paths: string[], side: Side): Promise<void> {
  return call<void>("take_side", { repoId, paths, side });
}

export function markResolved(repoId: RepoId, paths: string[]): Promise<void> {
  return call<void>("mark_resolved", { repoId, paths });
}

export function conflictedFiles(repoId: RepoId): Promise<string[]> {
  return call<string[]>("conflicted_files", { repoId });
}

export function openInEditor(repoId: RepoId, path: string): Promise<void> {
  return call<void>("open_in_editor", { repoId, path });
}
