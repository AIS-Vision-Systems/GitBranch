import type { Worktree } from "../../ipc/worktree";
import { samePath } from "../../lib/paths";

export interface WorktreeMark {
  path: string;
  /** Last path segment. */
  label: string;
  branch: string | null;
}

export function lastSegment(path: string): string {
  const parts = path.split(/[\\/]+/).filter((p) => p !== "");
  return parts[parts.length - 1] ?? path;
}

/**
 * Worktrees by the commit they have checked out. Bare entries, entries
 * without a HEAD and the current tab's own checkout (already the HEAD chip) are left out.
 */
export function worktreeMarksByOid(
  worktrees: readonly Worktree[],
  ownPath: string | null,
): Map<string, WorktreeMark[]> {
  const out = new Map<string, WorktreeMark[]>();
  for (const w of worktrees) {
    if (w.isBare || w.headOid === null) continue;
    if (ownPath !== null && samePath(w.path, ownPath)) continue;
    const mark: WorktreeMark = { path: w.path, label: lastSegment(w.path), branch: w.branch };
    const list = out.get(w.headOid);
    if (list === undefined) out.set(w.headOid, [mark]);
    else list.push(mark);
  }
  return out;
}
