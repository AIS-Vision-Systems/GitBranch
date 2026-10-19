import { call } from "./core";
import type { RepoId } from "./types";

export interface GithubUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  htmlUrl: string;
}

export interface GithubAccount {
  user: GithubUser;
  scopes: string[];
  /** True when the token exists but GitHub was unreachable; name/scopes unknown. */
  offline: boolean;
}

export interface GithubDeviceCode {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

/** OAuth App client id (mirrors crates/github-api/src/auth.rs CLIENT_ID, D-004). */
export const GITHUB_CLIENT_ID = "Ov23liz0pkJr73cVRaNX";
export const GITHUB_REVOKE_URL = `https://github.com/settings/connections/applications/${GITHUB_CLIENT_ID}`;

export const githubAccount = (): Promise<GithubAccount | null> => call("github_account");

export const githubLoginStart = (workflow: boolean): Promise<GithubDeviceCode> =>
  call("github_login_start", { workflow });

/** Resolves when the user authorizes; rejects with an IpcError (`github.cancelled`, `github.expired`, ...). */
export const githubLoginWait = (): Promise<GithubAccount> => call("github_login_wait");

export const githubLoginCancel = (): Promise<void> => call("github_login_cancel");

export interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  description: string | null;
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
  defaultBranch: string;
  pushedAt: string | null;
  language: string | null;
}

/** Rejects with `github.unauthorized` when signed out, `github.network`, `github.rate_limit`, ... */
export const githubRepos = (): Promise<GithubRepo[]> => call("github_repos");

export const githubLogout = (): Promise<void> => call("github_logout");

export interface GithubRepoSlug {
  remote: string;
  owner: string;
  name: string;
}

export type PullState = "open" | "closed" | "all";

export interface PullSummary {
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  merged: boolean;
  author: string;
  headRef: string;
  headSha: string;
  headRepo: string | null;
  baseRef: string;
  baseRepo: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  labels: string[];
}

/** state: approved | changes_requested | commented | dismissed | pending */
export interface Reviewer {
  login: string;
  state: string;
}

export interface ReviewSummary {
  approved: number;
  changesRequested: number;
  commented: number;
  reviewers: Reviewer[];
}

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  htmlUrl: string | null;
}

export interface ChecksSummary {
  total: number;
  success: number;
  failure: number;
  pending: number;
  skipped: number;
  overall: "none" | "failure" | "pending" | "success";
  runs: CheckRun[];
}

export interface PullDetail extends PullSummary {
  body: string | null;
  mergeable: boolean | null;
  mergeableState: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  comments: number;
  reviewComments: number;
  mergedBy: string | null;
  reviews: ReviewSummary;
  checks: ChecksSummary;
}

export interface CheckoutPrArgs {
  remote: string;
  number: number;
  headRef: string;
  sameRepo: boolean;
}

export const githubRepoSlug = (repoId: RepoId): Promise<GithubRepoSlug | null> =>
  call("github_repo_slug", { repoId });

export const githubPulls = (repoId: RepoId, pullState: PullState): Promise<PullSummary[]> =>
  call("github_pulls", { repoId, pullState });

export const githubPull = (repoId: RepoId, number: number): Promise<PullDetail> =>
  call("github_pull", { repoId, number });

/** Resolves with the local branch name; the backend emits repo-changed itself. */
export const githubCheckoutPull = (
  repoId: RepoId,
  args: CheckoutPrArgs,
  opId: string,
): Promise<string> => call("github_checkout_pull", { repoId, args, opId });

export interface NewPull {
  title: string;
  body: string | null;
  head: string;
  base: string;
  draft: boolean;
}

/** Repository metadata from GitHub (used for `defaultBranch`). */
export const githubRepoInfo = (repoId: RepoId): Promise<GithubRepo> =>
  call("github_repo_info", { repoId });

export const githubCreatePull = (repoId: RepoId, args: NewPull): Promise<PullSummary> =>
  call("github_create_pull", { repoId, args });

/** Backend caches for ~2 min; at most 50 shas; missing shas are simply absent. */
export const githubChecks = (
  repoId: RepoId,
  shas: string[],
  force: boolean,
): Promise<Record<string, ChecksSummary>> => call("github_checks", { repoId, shas, force });

export interface RateLimit {
  limit: number;
  remaining: number;
  /** Epoch seconds. */
  reset: number;
}

export interface GithubStatus {
  online: boolean;
  rateLimit: RateLimit | null;
  /** Epoch seconds; set while the backend refuses calls after a rate-limit response. */
  rateLimitedUntil: number | null;
}

export const githubStatus = (): Promise<GithubStatus> => call("github_status");
