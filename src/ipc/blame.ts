import { call } from "./core";
import type { RepoId } from "./types";

export interface BlameHunk {
  oid: string;
  author: string;
  /** Unix seconds. */
  authorTime: number;
  summary: string;
  /** 1-based first line of the hunk. */
  startLine: number;
  lineCount: number;
  boundary: boolean;
  path: string;
}

export interface Blame {
  hunks: BlameHunk[];
  lines: string[];
}

/** Blame `path` at `rev` (default: working tree). */
export function blame(repoId: RepoId, path: string, rev?: string): Promise<Blame> {
  return call<Blame>("blame", { repoId, path, rev });
}
