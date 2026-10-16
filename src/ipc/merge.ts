import { call } from "./core";
import type { RepoId } from "./types";

export type MergeMode = "default" | "fastForwardOnly" | "noFastForward" | "squash";
export type MergeOutcome = "alreadyUpToDate" | "fastForward" | "merged" | "squashed";
export type OpKind = "merge" | "rebase" | "cherryPick" | "revert";

export interface MergeArgs {
  source: string;
  mode: MergeMode;
  message: string | null;
}

export interface TodoEntry {
  oid: string;
  subject: string;
}

export type TodoAction = "pick" | "squash" | "fixup" | "drop";

export interface TodoItem {
  action: TodoAction;
  oid: string;
}

export interface InProgress {
  kind: OpKind;
  headName: string | null;
  onto: string | null;
  done: number;
  total: number;
}

export function merge(repoId: RepoId, args: MergeArgs): Promise<MergeOutcome> {
  return call<MergeOutcome>("merge", { repoId, args });
}

export function rebase(repoId: RepoId, onto: string, branch: string | null): Promise<void> {
  return call<void>("rebase", { repoId, onto, branch });
}

export function rebaseTodo(repoId: RepoId, onto: string): Promise<TodoEntry[]> {
  return call<TodoEntry[]>("rebase_todo", { repoId, onto });
}

export function rebaseInteractive(repoId: RepoId, onto: string, items: TodoItem[]): Promise<void> {
  return call<void>("rebase_interactive", { repoId, onto, items });
}

export function opAbort(repoId: RepoId, kind: OpKind): Promise<void> {
  return call<void>("op_abort", { repoId, kind });
}

export function opContinue(repoId: RepoId, kind: OpKind): Promise<void> {
  return call<void>("op_continue", { repoId, kind });
}

export function opSkip(repoId: RepoId, kind: OpKind): Promise<void> {
  return call<void>("op_skip", { repoId, kind });
}

export function opState(repoId: RepoId): Promise<InProgress | null> {
  return call<InProgress | null>("op_state", { repoId });
}
