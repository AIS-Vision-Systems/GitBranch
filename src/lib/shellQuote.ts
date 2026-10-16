const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;
const SPECIAL = /["\\$`]/g;

/** Quote a path for display in a git command preview; plain paths are left as is. */
export function quotePath(path: string): string {
  if (SAFE.test(path)) return path;
  return `"${path.replace(SPECIAL, (c) => `\\${c}`)}"`;
}

/** Quote and join several paths with single spaces. */
export function quotePaths(paths: string[]): string {
  return paths.map(quotePath).join(" ");
}
