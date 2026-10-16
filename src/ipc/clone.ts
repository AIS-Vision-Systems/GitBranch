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

/** Progress arrives on `op-progress` with `opId` (repoId ""); cancel with `cancelOp(opId)`. */
export function clone(args: CloneArgs, opId: string): Promise<CloneResult> {
  return call<CloneResult>("clone", { args, opId });
}
