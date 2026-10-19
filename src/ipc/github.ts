import { call } from "./core";

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

export const githubLogout = (): Promise<void> => call("github_logout");
