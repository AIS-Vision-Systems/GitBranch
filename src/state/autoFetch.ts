import type { RepoId } from "../ipc/types";
import { useOpsStore } from "./ops";

/**
 * Keeps the shown repo's remote refs fresh (D-042): a silent fetch now, then every `seconds`, and when
 * the window regains focus. Skipped while the window is hidden; `seconds <= 0` turns it off. A fetch
 * is skipped when the previous one finished less than half an interval ago (timer jitter, focus
 * bursts) or is still running. Returns the stop function.
 */
export function startAutoFetch(repoId: RepoId, seconds: number): () => void {
  if (!(seconds > 0)) return () => undefined;
  const intervalMs = seconds * 1000;
  const tick = (): void => {
    if (document.visibilityState === "hidden") return;
    void useOpsStore.getState().fetchQuiet(repoId, intervalMs / 2);
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  window.addEventListener("focus", tick);
  return () => {
    clearInterval(timer);
    window.removeEventListener("focus", tick);
  };
}
