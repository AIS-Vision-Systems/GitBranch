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
