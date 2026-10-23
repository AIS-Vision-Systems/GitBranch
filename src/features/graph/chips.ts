import type { Ref } from "../../ipc/types";
import { remoteTrackingName } from "./menus";

export interface ChipItem {
  gitRef: Ref;
  /** Local branch with a live upstream (not gone). */
  withUpstream: boolean;
  /** Remotes whose `<remote>/<branch>` ref is on this commit and is folded into this local chip. */
  remotes: string[];
}

const isRemote = (r: Ref): boolean => typeof r.kind === "object" && "remoteBranch" in r.kind;

function remoteOf(r: Ref): string {
  return typeof r.kind === "object" && "remoteBranch" in r.kind ? r.kind.remoteBranch.remote : "";
}

function rank(r: Ref): number {
  if (r.kind === "localBranch") return r.isHead ? 0 : 1;
  return isRemote(r) ? 2 : 3;
}

/**
 * Chips of one commit: HEAD first, then local, remote, tags. Every remote-tracking ref with the
 * same short name as a local branch on the same commit is folded into that branch's chip.
 */
export function chipItems(refs: readonly Ref[]): ChipItem[] {
  const locals = new Set<string>();
  for (const r of refs) if (r.kind === "localBranch") locals.add(r.name);
  const remotesByLocal = new Map<string, string[]>();
  const items: ChipItem[] = [];
  for (const r of refs) {
    if (!isRemote(r)) continue;
    const remote = remoteOf(r);
    const short = remoteTrackingName(r).slice(remote.length + 1);
    if (!locals.has(short)) continue;
    remotesByLocal.set(short, [...(remotesByLocal.get(short) ?? []), remote]);
  }
  for (const r of refs) {
    if (isRemote(r)) {
      const remote = remoteOf(r);
      if (locals.has(remoteTrackingName(r).slice(remote.length + 1))) continue;
    }
    items.push({
      gitRef: r,
      withUpstream: r.kind === "localBranch" && r.upstream !== null && !r.upstream.gone,
      remotes: r.kind === "localBranch" ? (remotesByLocal.get(r.name) ?? []) : [],
    });
  }
  return items.sort((a, b) => rank(a.gitRef) - rank(b.gitRef));
}
