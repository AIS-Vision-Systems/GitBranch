import { call } from "./core";
import type { RepoId } from "./types";

export type ConfigScope = "local" | "global";

export interface IdentityValue {
  value: string;
  /** As git prints it: "local" | "global" | "system" | "worktree" | "command". */
  scope: string;
}

export interface Identity {
  name: IdentityValue | null;
  email: IdentityValue | null;
}

export const gitIdentity = (repoId: RepoId): Promise<Identity> => call("git_identity", { repoId });

export const setGitIdentity = (
  repoId: RepoId,
  scope: ConfigScope,
  name: string,
  email: string,
): Promise<void> => call("set_git_identity", { repoId, scope, name, email });
