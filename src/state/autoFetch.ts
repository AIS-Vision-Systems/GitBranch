import type { RepoId } from "../ipc/types";
import { useOpsStore } from "./ops";

/** How often the shown repo is checked; `fetchQuiet` throttles to one fetch per minute (D-042). */
export const AUTO_FETCH_TICK_MS = 15_000;

/**
 * Keeps the shown repo's remote refs fresh: a silent fetch now, then whenever the throttle allows it,
 * and when the window regains focus. Skipped while the window is hidden. Returns the stop function.
 */
export function startAutoFetch(repoId: RepoId): () => void {
  const tick = (): void => {
    if (document.visibilityState === "hidden") return;
    void useOpsStore.getState().fetchQuiet(repoId);
  };
  tick();
  const timer = setInterval(tick, AUTO_FETCH_TICK_MS);
  window.addEventListener("focus", tick);
  return () => {
    clearInterval(timer);
    window.removeEventListener("focus", tick);
  };
}
