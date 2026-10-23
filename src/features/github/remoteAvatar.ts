import { remotesOf, useRemotesStore } from "../../state/remotes";
import type { RepoId } from "../../ipc/types";
import { useAvatar } from "./useAvatar";

const PATTERNS: RegExp[] = [
  /^https?:\/\/(?:[^@/\s]+@)?github\.com\/([^/\s]+)\/[^/\s]+?(?:\.git)?\/?$/i,
  /^ssh:\/\/(?:[^@/\s]+@)?github\.com\/([^/\s]+)\/[^/\s]+?(?:\.git)?\/?$/i,
  /^[^@/\s]+@github\.com:([^/\s]+)\/[^/\s]+?(?:\.git)?\/?$/i,
];
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** GitHub owner (user or organisation) of a remote URL, or null for non-GitHub / unparsable URLs. */
export function githubOwner(url: string): string | null {
  const u = url.trim();
  for (const re of PATTERNS) {
    const owner = re.exec(u)?.[1];
    if (owner !== undefined) return LOGIN.test(owner) ? owner : null;
  }
  return null;
}

/** Avatar data URL of the GitHub owner of remote `remoteName`, or null (not GitHub / not loaded). */
export function useRemoteAvatar(repoId: RepoId, remoteName: string): string | null {
  const owner = useRemotesStore((s) => {
    const url = remotesOf(s, repoId).find((r) => r.name === remoteName)?.fetchUrl;
    return url === undefined ? null : githubOwner(url);
  });
  return useAvatar(owner);
}
