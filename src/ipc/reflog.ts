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

export interface UndoOutcome {
  info: UndoInfo;
  redo: UndoAction;
  head: string;
  branch: string | null;
}

export function undoPreview(repoId: RepoId): Promise<UndoInfo | null> {
  return call<UndoInfo | null>("undo_preview", { repoId });
}

export function undoLast(repoId: RepoId): Promise<UndoOutcome> {
  return call<UndoOutcome>("undo_last", { repoId });
}

export function applyAction(repoId: RepoId, action: UndoAction): Promise<void> {
  return call<void>("apply_action", { repoId, action });
}
