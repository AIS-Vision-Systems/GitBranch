export interface AppError {
  code: string;
  message: string;
  detail?: string;
}

export interface AppInfo {
  version: string;
  gitCoreVersion: string;
  githubApiVersion: string;
}

export type RepoId = string & { readonly __brand: "RepoId" };

export interface OpenedRepo {
  repoId: RepoId;
  name: string;
  path: string;
  gitDir: string;
  isWorktree: boolean;
  mainWorkTree: string | null;
  isBare: boolean;
}

export interface RecentRepo {
  path: string;
  name: string;
  /** Unix milliseconds. */
  lastOpened: number;
}

export interface OpenedRepo {
  repoId: RepoId;
  name: string;
  path: string;
  gitDir: string;
  isWorktree: boolean;
  mainWorkTree: string | null;
  isBare: boolean;
}
