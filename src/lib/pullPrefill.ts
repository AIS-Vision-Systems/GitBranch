import type { RangeCommit } from "../ipc/history";

/** "feature/my-branch_name" becomes "Feature my branch name". */
export function titleFromBranch(branch: string): string {
  const t = branch.replace(/[-_/]+/g, " ").trim();
  return t === "" ? branch : t.charAt(0).toUpperCase() + t.slice(1);
}

/** `commits` is newest first (git log order). */
export function prefill(branch: string, commits: RangeCommit[]): { title: string; body: string } {
  const [only] = commits;
  if (commits.length === 1 && only !== undefined) {
    return { title: only.subject, body: only.body.trim() };
  }
  return {
    title: titleFromBranch(branch),
    body: [...commits]
      .reverse()
      .map((c) => `- ${c.subject}`)
      .join("\n"),
  };
}
