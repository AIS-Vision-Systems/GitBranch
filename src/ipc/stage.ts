import { call } from "./core";
import type { DiffTarget } from "./commit";
import type { RepoId } from "./types";

export type PatchOp = "stage" | "unstage" | "discard";

export interface HunkSelection {
  /** Only `staged` or `unstaged` targets are valid. */
  target: DiffTarget;
  hunkIndex: number;
  /** `Hunk.header` at the time the diff was shown (stale check). */
  hunkHeader: string;
  /** Indices into `Hunk.lines` of add/del lines; null = whole hunk. */
  lines: number[] | null;
}

export function stageFiles(repoId: RepoId, paths: string[]): Promise<void> {
  return call<void>("stage_files", { repoId, paths });
}

export function unstageFiles(repoId: RepoId, paths: string[]): Promise<void> {
  return call<void>("unstage_files", { repoId, paths });
}

export function discardFiles(
  repoId: RepoId,
  tracked: string[],
  untracked: string[],
): Promise<void> {
  return call<void>("discard_files", { repoId, tracked, untracked });
}

export function stageAll(repoId: RepoId): Promise<void> {
  return call<void>("stage_all", { repoId });
}

export function unstageAll(repoId: RepoId): Promise<void> {
  return call<void>("unstage_all", { repoId });
}

export function applyHunk(repoId: RepoId, selection: HunkSelection, op: PatchOp): Promise<void> {
  return call<void>("apply_hunk", { repoId, selection, op });
}
