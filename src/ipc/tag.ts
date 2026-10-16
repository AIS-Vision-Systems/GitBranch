import { call } from "./core";
import type { RepoId } from "./types";

export interface TagArgs {
  name: string;
  target: string;
  /** null creates a lightweight tag. */
  message: string | null;
  force: boolean;
}

export function createTag(repoId: RepoId, args: TagArgs): Promise<void> {
  return call<void>("create_tag", { repoId, args });
}

export function deleteTag(repoId: RepoId, name: string): Promise<void> {
  return call<void>("delete_tag", { repoId, name });
}
