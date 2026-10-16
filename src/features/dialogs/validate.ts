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
