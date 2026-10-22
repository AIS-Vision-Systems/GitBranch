import { call } from "./core";

export interface CloneArgs {
  url: string;
  dest: string;
  branch: string | null;
  depth: number | null;
  recurseSubmodules: boolean;
}

export interface CloneResult {
  /** The new work tree. */
  path: string;
}

export interface RemoteHeads {
  defaultBranch: string | null;
  branches: string[];
}

/** `git ls-remote`; slow or rejecting when unreachable. `cancelOp(opId)` kills it (rejects as cancelled). */
export function listRemoteHeads(url: string, opId: string): Promise<RemoteHeads> {
  return call<RemoteHeads>("list_remote_heads", { url, opId });
}

/** Progress arrives on `op-progress` with `opId` (repoId ""); cancel with `cancelOp(opId)`. */
export function clone(args: CloneArgs, opId: string): Promise<CloneResult> {
  return call<CloneResult>("clone", { args, opId });
}
