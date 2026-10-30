import type { RepoId } from "../ipc/types";
import { useOpsStore } from "./ops";
import { usePullsStore } from "./pulls";

/**
 * Keeps the shown repo's remote refs fresh (D-042): a silent fetch now, then every `seconds`, and when
 * the window regains focus. Skipped while the window is hidden; `seconds <= 0` turns it off. A fetch
 * is skipped when the previous one finished less than half an interval ago (timer jitter, focus
 * bursts) or is still running. Each tick also quietly reloads the sidebar's pull requests (and the
 * selected one) when they were loaded already, at most every max(half an interval, 15 s). Returns the
 * stop function.
 */
export function startAutoFetch(repoId: RepoId, seconds: number): () => void {
  if (!(seconds > 0)) return () => undefined;
  const intervalMs = seconds * 1000;
  const tick = (): void => {
    if (document.visibilityState === "hidden") return;
    void useOpsStore.getState().fetchQuiet(repoId, intervalMs / 2);
    void usePullsStore.getState().refreshQuiet(repoId, Math.max(intervalMs / 2, 15_000));
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  window.addEventListener("focus", tick);
  return () => {
    clearInterval(timer);
    window.removeEventListener("focus", tick);
  };
}
