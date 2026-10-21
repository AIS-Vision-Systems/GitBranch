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
