import { saveSession, type Session } from "../ipc/app";
import type { OpenedRepo } from "../ipc/types";
import { orderTabs } from "../lib/tabOrder";
import { useReposStore } from "./repos";
import { reportError } from "./ui";

export const SESSION_SAVE_DELAY_MS = 300;

/** Open repo paths in tab order plus the current repo's path (null on the "new tab" view). */
export function deriveSession(
  open: readonly OpenedRepo[],
  currentId: string | null,
  aliases: Record<string, string> = {},
): Session {
  const tabs = orderTabs(open);
  return {
    open: tabs.map((r) => r.path),
    current: tabs.find((r) => r.repoId === currentId)?.path ?? null,
    aliases: { ...aliases },
  };
}

/**
 * Persists the session (debounced) whenever the open tabs, their order or the current tab change.
 * Call it after the startup restore so the restore itself is not saved. Returns a stop function.
 */
export function startSessionSync(delayMs: number = SESSION_SAVE_DELAY_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = useReposStore.subscribe((s, prev) => {
    if (s.open === prev.open && s.currentId === prev.currentId && s.aliases === prev.aliases)
      return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const { open, currentId, aliases } = useReposStore.getState();
      saveSession(deriveSession(open, currentId, aliases)).catch((e: unknown) =>
        reportError(e, "Could not save the session"),
      );
    }, delayMs);
  });
  return () => {
    unsubscribe();
    if (timer !== null) clearTimeout(timer);
  };
}
