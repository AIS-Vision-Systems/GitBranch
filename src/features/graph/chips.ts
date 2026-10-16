import type { Ref } from "../../ipc/types";
import { remoteTrackingName } from "./menus";

export interface ChipItem {
  gitRef: Ref;
  /** Local branch with a live upstream: the cloud icon replaces a separate remote chip. */
  withUpstream: boolean;
}

const isRemote = (r: Ref): boolean => typeof r.kind === "object" && "remoteBranch" in r.kind;

function rank(r: Ref): number {
  if (r.kind === "localBranch") return r.isHead ? 0 : 1;
  return isRemote(r) ? 2 : 3;
}

/**
 * Chips of one commit: HEAD first, then local, remote, tags. A remote-tracking ref that is the
 * upstream of a local branch on the same commit is folded into that branch's chip.
 */
export function chipItems(refs: readonly Ref[]): ChipItem[] {
  const folded = new Set<string>();
  for (const r of refs) {
    if (r.kind === "localBranch" && r.upstream !== null && !r.upstream.gone) {
      folded.add(r.upstream.name);
    }
  }
  const items: ChipItem[] = [];
  for (const r of refs) {
    if (isRemote(r) && folded.has(remoteTrackingName(r))) continue;
    items.push({
      gitRef: r,
      withUpstream: r.kind === "localBranch" && r.upstream !== null && !r.upstream.gone,
    });
  }
  return items.sort((a, b) => rank(a.gitRef) - rank(b.gitRef));
}
