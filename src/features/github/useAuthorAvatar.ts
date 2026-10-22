import { useGithubStore } from "../../state/github";
import { loginForAuthor } from "./authorLogin";
import { useAvatar } from "./useAvatar";

/** Avatar data URL for a commit author when known on GitHub, else null (callers show initials). */
export function useAuthorAvatar(email: string): string | null {
  const account = useGithubStore((s) => s.account);
  return useAvatar(loginForAuthor(email, account?.user ?? null));
}
