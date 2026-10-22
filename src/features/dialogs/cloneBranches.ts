export interface BranchOption {
  /** "" = remote default (clone sends `branch: null`). */
  value: string;
  label: string;
}

/** First option is the remote default; then every remote branch (the default included). */
export function buildBranchOptions(
  defaultBranch: string | null | undefined,
  branches: readonly string[],
): BranchOption[] {
  const def = defaultBranch ?? null;
  const first: BranchOption = {
    value: "",
    label: def === null ? "Default branch" : `Default branch (${def})`,
  };
  return [first, ...branches.map((b) => ({ value: b, label: b }))];
}

/** One-line reason for the muted fallback note. */
export function shortReason(e: unknown, max = 80): string {
  const raw = e instanceof Error ? e.message : String(e);
  const line = raw.split(/\r?\n/).find((l) => l.trim() !== "") ?? "unknown error";
  const t = line.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Stricter than `validateCloneUrl`: true only when the URL looks complete enough for `ls-remote`. */
export function isLookupReady(url: string): boolean {
  const u = url.trim();
  if (/^[A-Za-z]:[\\/]\S/.test(u) || /^\/\S/.test(u)) return true;
  const m = /^(?:https?|ssh|git):\/\/(?:[^/@\s]+@)?([^/:\s]+)(?::\d+)?\/(\S+)$/i.exec(u);
  if (m) {
    const host = m[1] ?? "";
    const path = (m[2] ?? "").replace(/\/+$/, "");
    return path !== "" && (host.toLowerCase() === "localhost" || /^[^.]+(\.[^.]+)+$/.test(host));
  }
  return /^[^@\s/:]+@[^@\s/:]+:\S+$/.test(u);
}
