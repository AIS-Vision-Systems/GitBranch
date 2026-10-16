const FORBIDDEN = new RegExp("[~^:?*\\[\\\\]");

/** Client-side sanity check for branch and tag names; git remains the authority. Returns an error or null. */
export function validateRefName(name: string): string | null {
  if (name === "") return "Name is required";
  if (/\s/.test(name)) return "Name cannot contain spaces";
  if (name.startsWith("-")) return "Name cannot start with '-'";
  if (name.includes("..")) return "Name cannot contain '..'";
  if (FORBIDDEN.test(name)) return "Name cannot contain ~ ^ : ? * [ or \\";
  return null;
}

/** Remote names: letters, digits, '.', '_' and '-', not starting with '-' or '.'. */
export function validateRemoteName(name: string): string | null {
  if (name === "") return "Name is required";
  if (name.startsWith("-") || name.startsWith(".")) return "Name cannot start with '-' or '.'";
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return "Use letters, digits, '.', '_' and '-' only";
  return null;
}

export function validateRemoteUrl(url: string): string | null {
  const u = url.trim();
  if (u === "") return "URL is required";
  if (u.startsWith("-")) return "URL cannot start with '-'";
  return null;
}
