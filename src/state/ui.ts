import { create } from "zustand";
import { isIpcError } from "../ipc/core";

export type Theme = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export interface Toast {
  id: string;
  kind: "error" | "info" | "success";
  title: string;
  detail?: string;
  createdAt: number;
}

const MAX_TOASTS = 5;
const AUTO_DISMISS_MS = 5000;

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== "system") return theme;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

interface UiState {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  /** Recompute resolvedTheme (e.g. when the OS preference changes). */
  refreshTheme: () => void;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id" | "createdAt">) => string;
  dismissToast: (id: string) => void;
}

let nextId = 1;

export const useUiStore = create<UiState>((set, get) => ({
  theme: "system",
  resolvedTheme: resolveTheme("system"),
  setTheme: (theme) => set({ theme, resolvedTheme: resolveTheme(theme) }),
  refreshTheme: () => set({ resolvedTheme: resolveTheme(get().theme) }),
  toasts: [],
  pushToast: (t) => {
    const id = `toast-${nextId++}`;
    const toast: Toast = { ...t, id, createdAt: Date.now() };
    set((s) => ({ toasts: [...s.toasts, toast].slice(-MAX_TOASTS) }));
    if (t.kind !== "error") {
      setTimeout(() => get().dismissToast(id), AUTO_DISMISS_MS);
    }
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export function reportError(err: unknown, title?: string): void {
  let message: string;
  let detail: string | undefined;
  if (isIpcError(err)) {
    message = err.error.message;
    detail =
      err.error.detail !== undefined ? `${err.error.code}: ${err.error.detail}` : err.error.code;
  } else if (err instanceof Error) {
    message = err.message;
  } else {
    message = String(err);
  }
  // With an explicit title the message moves into the (collapsible) detail.
  const shownTitle = title ?? message;
  const shownDetail =
    title !== undefined ? (detail !== undefined ? `${message}\n${detail}` : message) : detail;
  useUiStore.getState().pushToast({
    kind: "error",
    title: shownTitle,
    ...(shownDetail !== undefined ? { detail: shownDetail } : {}),
  });
}
