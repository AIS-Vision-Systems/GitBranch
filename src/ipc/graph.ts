import { call } from "./core";
import type { GraphPage, GraphQuery, RepoId, Refs, Status } from "./types";

export function loadGraph(repoId: RepoId, query: GraphQuery): Promise<GraphPage> {
  return call<GraphPage>("load_graph", { repoId, query });
}

export function listRefs(repoId: RepoId): Promise<Refs> {
  return call<Refs>("list_refs", { repoId });
}

export function repoStatus(repoId: RepoId): Promise<Status> {
  return call<Status>("repo_status", { repoId });
}
