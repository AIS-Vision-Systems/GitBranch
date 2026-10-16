import type { PushedRef, Remote } from "../ipc/remote";
import type { Refs } from "../ipc/types";

const SHORT = /^refs\/(heads|tags|remotes)\//;
const short = (r: string): string => r.replace(SHORT, "");

/** "main → origin/main" lines for a push result, at most `max` shown. */
export function pushSummary(refs: PushedRef[], remote: string, max = 3): string {
  const lines = refs.map((r) => {
    const to = short(r.to);
    const from = short(r.from);
    const left = from === "" ? "(delete)" : from;
    const base = `${left} → ${remote}/${to}`;
    return r.flag === "=" ? `${base} (up to date)` : base;
  });
  if (lines.length <= max) return lines.join(", ");
  return `${lines.slice(0, max).join(", ")} +${lines.length - max} more`;
}

/** The remote an upstream like "origin/main" belongs to (remote names may contain "/"). */
export function upstreamRemote(upstream: string | null, remotes: Remote[]): string | null {
  if (upstream === null) return null;
  let best: string | null = null;
  for (const r of remotes) {
    if (upstream.startsWith(`${r.name}/`) && (best === null || r.name.length > best.length)) {
      best = r.name;
    }
  }
  return best;
}

/** Branch part of an upstream ("origin/main" -> "main"), or null. */
export function upstreamBranch(upstream: string | null, remotes: Remote[]): string | null {
  const remote = upstreamRemote(upstream, remotes);
  return upstream !== null && remote !== null ? upstream.slice(remote.length + 1) : null;
}

/** Default remote: the upstream's (unless gone), then "origin", then the first one. */
export function preferredRemote(
  upstream: { name: string; gone: boolean } | null,
  remotes: Remote[],
): string {
  const live = upstream !== null && !upstream.gone ? upstream.name : null;
  return (
    upstreamRemote(live, remotes) ??
    (remotes.some((r) => r.name === "origin") ? "origin" : (remotes[0]?.name ?? "origin"))
  );
}

export interface PushDefaults {
  remote: string;
  branch: string | null;
  /** Branch name on the remote; null = same as `branch`. */
  remoteBranch: string | null;
  setUpstream: boolean;
  hasUpstream: boolean;
}

/** Defaults for pushing `branch` (null = the current one). Null when there is no remote. */
export function pushDefaults(
  refs: Refs | null,
  remotes: Remote[],
  branch: string | null = null,
): PushDefaults | null {
  if (remotes.length === 0) return null;
  const name = branch ?? refs?.head.branch ?? null;
  const ref = refs?.refs.find((r) => r.kind === "localBranch" && r.name === name);
  const up = ref?.upstream ?? null;
  const upstream = up !== null && !up.gone ? up.name : null;
  return {
    remote: preferredRemote(up, remotes),
    branch: name,
    remoteBranch: upstreamBranch(upstream, remotes),
    setUpstream: upstream === null,
    hasUpstream: upstream !== null,
  };
}
