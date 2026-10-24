export function isWindows(): boolean {
  return typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);
}

function norm(p: string): string {
  const s = p.replace(/\\/g, "/");
  return s.length > 1 ? s.replace(/\/+$/, "") : s;
}

/** Stable map key for a path: same normalisation as `samePath`. */
export function pathKey(p: string, caseInsensitive: boolean = isWindows()): string {
  const x = norm(p);
  return caseInsensitive ? x.toLowerCase() : x;
}

/** Path equality after normalising separators (and case on Windows). */
export function samePath(a: string, b: string, caseInsensitive: boolean = isWindows()): boolean {
  const x = norm(a);
  const y = norm(b);
  return caseInsensitive ? x.toLowerCase() === y.toLowerCase() : x === y;
}
