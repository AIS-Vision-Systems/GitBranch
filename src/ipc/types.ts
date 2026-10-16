export interface AppError {
  code: string;
  message: string;
  detail?: string;
}

export interface AppInfo {
  version: string;
  gitCoreVersion: string;
  githubApiVersion: string;
  /** Repository path passed on the command line, opened on start. */
  startupRepo: string | null;
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

export interface Commit {
  oid: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorTime: number;
  committerTime: number;
  subject: string;
}
export type EdgeKind = "straight" | "mergeIn" | "branchOut";
export interface Edge {
  fromLane: number;
  toLane: number;
  kind: EdgeKind;
  color: number;
}
export interface Row {
  oid: string;
  lane: number;
  color: number;
  hasIncoming: boolean;
  edges: Edge[];
}
export interface GraphQuery {
  order: "date" | "topo";
  skip: number;
  limit: number;
  all: boolean;
}
export interface GraphPage {
  commits: Commit[];
  rows: Row[];
  hasMore: boolean;
  nextSkip: number;
}
export type RefKind =
  "localBranch" | { remoteBranch: { remote: string } } | { tag: { annotated: boolean } };
export interface Upstream {
  name: string;
  ahead: number;
  behind: number;
  gone: boolean;
}
export interface Ref {
  name: string;
  fullName: string;
  kind: RefKind;
  target: string;
  upstream: Upstream | null;
  isHead: boolean;
}
export interface Head {
  oid: string | null;
  branch: string | null;
  detached: boolean;
}
export interface Refs {
  head: Head;
  refs: Ref[];
}
export type FileState =
  | "unmodified"
  | "modified"
  | "typeChanged"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "ignored"
  | "unmerged";
export interface StatusEntry {
  path: string;
  origPath: string | null;
  staged: FileState;
  unstaged: FileState;
  conflicted: boolean;
  submodule: boolean;
}
export interface StatusBranch {
  oid: string | null;
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}
export interface Status {
  branch: StatusBranch | null;
  entries: StatusEntry[];
}
