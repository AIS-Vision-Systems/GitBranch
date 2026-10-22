/** Above this many rows wrapping is disabled (fixed-height rows, virtualized). */
export const WRAP_BELOW = 5000;
export const WRAP_KEY = "gitbranch.diffWrap";

export function loadWrap(): boolean {
  try {
    return localStorage.getItem(WRAP_KEY) !== "false";
  } catch {
    return true;
  }
}

/**
 * Per-row heights for the aligned split panes. With wrap on, each pair takes the taller of its
 * two measured heights. With wrap off nothing is measured or forced (null: rows size naturally
 * to one line), so no stale wrapped height can survive a toggle.
 */
export function pairHeights(wrap: boolean, left: number[], right: number[]): number[] | null {
  if (!wrap) return null;
  const n = Math.min(left.length, right.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.max(left[i]!, right[i]!));
  return out;
}
