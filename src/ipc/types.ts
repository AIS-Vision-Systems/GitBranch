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
