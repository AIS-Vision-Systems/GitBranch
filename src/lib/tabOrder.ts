import type { OpenedRepo } from "../ipc/types";
import { pathKey, samePath } from "./paths";

const groupPath = (r: OpenedRepo): string => r.mainWorkTree ?? r.path;

/** Tabs grouped by repository (main checkout + its worktrees), groups and members in open order. */
export function groupTabs(open: readonly OpenedRepo[]): OpenedRepo[][] {
  const groups: OpenedRepo[][] = [];
  for (const r of open) {
    const g = groups.find((m) => samePath(groupPath(m[0]!), groupPath(r)));
    if (g === undefined) groups.push([r]);
    else g.push(r);
  }
  return groups;
}

/** Tabs in display order: groups flattened. */
export function orderTabs(open: readonly OpenedRepo[]): OpenedRepo[] {
  return groupTabs(open).flat();
}

/** Label of a tab: the user's alias for the repository path, else its folder name. */
export function tabName(repo: OpenedRepo, aliases: Readonly<Record<string, string>>): string {
  return aliases[pathKey(repo.path)] ?? repo.name;
}
