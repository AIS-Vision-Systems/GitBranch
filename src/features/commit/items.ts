import type { ChangeKind, CommitDetails, DiffTarget } from "../../ipc/commit";
import type { FileState, StatusEntry } from "../../ipc/types";
import type { FileListItem } from "./FileList";

export function commitItems(d: CommitDetails): FileListItem[] {
  return d.files.map((f) => {
    const target: DiffTarget = { kind: "commit", oid: d.oid, path: f.path };
    return {
      key: `c:${f.path}`,
      path: f.path,
      origPath: f.origPath,
      kind: f.kind,
      target,
      label: f.origPath !== null ? `${f.origPath} → ${f.path}` : f.path,
    };
  });
}

function kindOf(s: FileState): ChangeKind {
  switch (s) {
    case "added":
    case "modified":
    case "deleted":
    case "renamed":
    case "copied":
    case "typeChanged":
    case "unmerged":
      return s;
    case "unmodified":
    case "untracked":
    case "ignored":
    default:
      return "unknown";
  }
}

/** One row per target: staged, unstaged and untracked entries are listed separately. */
export function wipItems(entries: StatusEntry[]): FileListItem[] {
  const out: FileListItem[] = [];
  const push = (
    e: StatusEntry,
    kind: ChangeKind,
    t: "staged" | "unstaged" | "untracked",
    suffix: string,
  ): void => {
    out.push({
      key: `${t}:${e.path}`,
      path: e.path,
      origPath: t === "staged" ? e.origPath : null,
      kind,
      suffix,
      target: { kind: t, path: e.path },
      label: `${e.path} ${suffix}`,
      ...(e.conflicted ? { conflicted: true } : {}),
    });
  };
  for (const e of entries) {
    if (e.unstaged === "untracked") {
      push(e, "unknown", "untracked", "(untracked)");
      continue;
    }
    if (e.conflicted) {
      push(e, "unmerged", "unstaged", "(unstaged)");
      continue;
    }
    if (e.staged !== "unmodified" && e.staged !== "ignored") {
      push(e, kindOf(e.staged), "staged", "(staged)");
    }
    if (e.unstaged !== "unmodified" && e.unstaged !== "ignored") {
      push(e, kindOf(e.unstaged), "unstaged", "(unstaged)");
    }
  }
  return out;
}
