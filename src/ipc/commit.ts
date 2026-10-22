import { call } from "./core";
import type { RepoId } from "./types";

export type ChangeKind =
  "added" | "modified" | "deleted" | "renamed" | "copied" | "typeChanged" | "unmerged" | "unknown";

export interface ChangedFile {
  path: string;
  origPath: string | null;
  kind: ChangeKind;
  similarity: number | null;
}

export interface CoAuthor {
  name: string;
  email: string;
}

export interface CommitDetails {
  oid: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorTime: number;
  committerName: string;
  committerEmail: string;
  committerTime: number;
  subject: string;
  body: string;
  coAuthors: CoAuthor[];
  files: ChangedFile[];
}

export type DiffTarget =
  | { kind: "commit"; oid: string; path: string }
  | { kind: "staged"; path: string }
  | { kind: "unstaged"; path: string }
  | { kind: "untracked"; path: string };

export type LineKind = "context" | "add" | "del";

export interface DiffLine {
  kind: LineKind;
  text: string;
  oldNo: number | null;
  newNo: number | null;
  noNewline: boolean;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  oldPath: string | null;
  newPath: string | null;
  binary: boolean;
  hunks: Hunk[];
  oldMode: string | null;
  newMode: string | null;
  /** Conflicted file: only a combined diff exists, not rendered yet. */
  combined?: boolean;
  /** File exceeds the backend size limit; no hunks are sent. */
  tooLarge?: boolean;
}

export function commitDetails(repoId: RepoId, oid: string): Promise<CommitDetails> {
  return call<CommitDetails>("commit_details", { repoId, oid });
}

export function fileDiff(repoId: RepoId, target: DiffTarget): Promise<FileDiff> {
  return call<FileDiff>("file_diff", { repoId, target });
}

export interface CommitArgs {
  message: string;
  amend: boolean;
  signoff: boolean;
  allowEmpty: boolean;
  noVerify: boolean;
}

export interface CommitTemplate {
  message: string;
  source: "mergeMsg" | "squashMsg" | "configTemplate";
}

export function commit(repoId: RepoId, args: CommitArgs): Promise<string> {
  return call<string>("commit", { repoId, args });
}

export function commitTemplate(repoId: RepoId): Promise<CommitTemplate | null> {
  return call<CommitTemplate | null>("commit_template", { repoId });
}

export function headMessage(repoId: RepoId): Promise<string> {
  return call<string>("head_message", { repoId });
}
