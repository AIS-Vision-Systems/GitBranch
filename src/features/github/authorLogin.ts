const NOREPLY = /^(?:\d+\+)?([^@+\s]+)@users\.noreply\.github\.com$/i;

/** GitHub login for a commit author: noreply emails, the signed-in account's email, or the git identity email. */
export function loginForAuthor(
  email: string,
  account: { login: string; email: string | null } | null,
  identityEmail?: string | null,
): string | null {
  const e = email.trim().toLowerCase();
  if (e === "") return null;
  const m = NOREPLY.exec(e);
  if (m) return m[1]!;
  if (account === null) return null;
  const same = (other: string | null | undefined): boolean => other?.trim().toLowerCase() === e;
  return same(account.email) || same(identityEmail) ? account.login : null;
}
