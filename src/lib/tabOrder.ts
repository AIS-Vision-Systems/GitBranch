import type { OpenedRepo } from "../ipc/types";
import { samePath } from "./paths";

const groupPath = (r: OpenedRepo): string => r.mainWorkTree ?? r.path;

/** Tabs grouped by repository (main checkout + its worktrees), groups and members in open order. */
export function orderTabs(open: readonly OpenedRepo[]): OpenedRepo[] {
  const groups: OpenedRepo[][] = [];
  for (const r of open) {
    const g = groups.find((m) => samePath(groupPath(m[0]!), groupPath(r)));
    if (g === undefined) groups.push([r]);
    else g.push(r);
  }
  return groups.flat();
}
