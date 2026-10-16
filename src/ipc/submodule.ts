import { call } from "./core";
import type { RepoId } from "./types";

export type SubmoduleState = "clean" | "modified" | "uninitialized" | "conflict";

export interface Submodule {
  path: string;
  headOid: string | null;
  state: SubmoduleState;
  describe: string | null;
  url: string | null;
}

export async function listSubmodules(repoId: RepoId): Promise<Submodule[]> {
  return call<Submodule[]>("list_submodules", { repoId });
}
