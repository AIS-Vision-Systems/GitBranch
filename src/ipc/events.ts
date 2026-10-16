import { listen } from "@tauri-apps/api/event";
import type { RepoId } from "./types";

export type Change = "head" | "refs" | "index" | "workingTree";
export interface RepoChanged {
  repoId: RepoId;
  what: Change[];
}

export function onRepoChanged(cb: (e: RepoChanged) => void): Promise<() => void> {
  return listen<RepoChanged>("repo-changed", (ev) => cb(ev.payload));
}

export interface OpProgress {
  opId: string;
  repoId: RepoId;
  /** "Receiving objects", "Resolving deltas", ... or "" when unknown. */
  phase: string;
  /** 0..100, or null when indeterminate. */
  pct: number | null;
  /** Last raw progress line, trimmed. */
  msg: string;
}

export function onOpProgress(cb: (e: OpProgress) => void): Promise<() => void> {
  return listen<OpProgress>("op-progress", (ev) => cb(ev.payload));
}
