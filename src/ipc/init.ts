import { call } from "./core";

export interface InitRepoArgs {
  /** Absolute path of the new repository folder (new or empty). */
  dest: string;
  /** null = git's default branch name. */
  initialBranch: string | null;
  /** Write a README.md and make the initial commit. */
  readme: boolean;
}

export interface InitRepoResult {
  /** The new work tree. */
  path: string;
  /** Set when the repository was created but the initial commit failed (the repository is kept). */
  commitError: string | null;
}

/** `git init` (plus an optional README and initial commit). */
export function initRepo(args: InitRepoArgs): Promise<InitRepoResult> {
  return call<InitRepoResult>("init_repo", { args });
}
