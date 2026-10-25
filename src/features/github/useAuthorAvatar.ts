import type { RepoId } from "../../ipc/types";
import { useGithubStore } from "../../state/github";
import { useIdentityStore } from "../../state/identity";
import { remotesOf, useRemotesStore } from "../../state/remotes";
import { loginForAuthor } from "./authorLogin";
import { githubOwner } from "./remoteAvatar";
import { useAvatar, useEmailAvatar } from "./useAvatar";

/**
 * Avatar data URL for a commit author, else null (callers show initials).
 * Lookup-free first (`loginForAuthor`: noreply addresses, the signed-in account, the repo's git identity);
 * otherwise, only when the repo has a GitHub remote, the email is resolved through GitHub's avatar CDN
 * (D-038): the authors of a GitHub-hosted repo are already known to GitHub.
 */
export function useAuthorAvatar(email: string, repoId?: RepoId): string | null {
  const account = useGithubStore((s) => s.account);
  const identityEmail = useIdentityStore((s) =>
    repoId !== undefined ? (s.byRepo[repoId]?.email ?? null) : null,
  );
  const onGithub = useRemotesStore(
    (s) =>
      repoId !== undefined && remotesOf(s, repoId).some((r) => githubOwner(r.fetchUrl) !== null),
  );
  const login = loginForAuthor(email, account?.user ?? null, identityEmail);
  const byLogin = useAvatar(login);
  const byEmail = useEmailAvatar(login === null && onGithub ? email : null);
  return byLogin ?? byEmail;
}
