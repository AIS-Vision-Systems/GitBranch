import type { RepoId } from "../../ipc/types";
import { useGithubStore } from "../../state/github";
import { useIdentityStore } from "../../state/identity";
import { loginForAuthor } from "./authorLogin";
import { useAvatar } from "./useAvatar";

/**
 * Avatar data URL for a commit author when known on GitHub, else null (callers show initials).
 * With `repoId`, the repo's own git email also maps to the signed-in GitHub user.
 */
export function useAuthorAvatar(email: string, repoId?: RepoId): string | null {
  const account = useGithubStore((s) => s.account);
  const identityEmail = useIdentityStore((s) =>
    repoId !== undefined ? (s.byRepo[repoId]?.email ?? null) : null,
  );
  return useAvatar(loginForAuthor(email, account?.user ?? null, identityEmail));
}
