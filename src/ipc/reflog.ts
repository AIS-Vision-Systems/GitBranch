import { call } from "./core";
import type { RepoId } from "./types";

export type UndoAction =
  | { kind: "resetKeep"; target: string }
  | { kind: "resetSoft"; target: string }
  | { kind: "checkout"; target: string; detach: boolean };

export interface UndoInfo {
  label: string;
  action: UndoAction;
}

export function undoPreview(repoId: RepoId): Promise<UndoInfo | null> {
  return call<UndoInfo | null>("undo_preview", { repoId });
}

export function undoLast(repoId: RepoId): Promise<UndoInfo> {
  return call<UndoInfo>("undo_last", { repoId });
}
