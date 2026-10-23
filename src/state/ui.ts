import { create } from "zustand";
import { isIpcError } from "../ipc/core";
import type { RepoId } from "../ipc/types";

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

export const THEME_KEY = "gitbranch.theme";

/** Persisted choice, defaulting to dark. Storage may be unavailable or corrupt. */
export function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "system" || v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return "dark";
}

function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

export const SIDEBAR_KEY = "gitbranch.sidebar";

/** Persisted sidebar visibility, defaulting to open. */
export function loadSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "closed";
  } catch {
    return true;
  }
}

function saveSidebarOpen(open: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, open ? "open" : "closed");
  } catch {
    /* ignore */
  }
}

export const SIDEBAR_SECTIONS_KEY = "gitbranch.sidebarSections";

/** Persisted open/closed state per sidebar section id (missing id = open). */
export function loadSidebarSections(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SIDEBAR_SECTIONS_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "boolean") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function saveSidebarSections(sections: Record<string, boolean>): void {
  try {
    localStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify(sections));
  } catch {
    /* ignore */
  }
}

export interface BlameTarget {
  repoId: RepoId;
  path: string;
  rev?: string;
}

interface UiState {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  /** Recompute resolvedTheme (e.g. when the OS preference changes). */
  refreshTheme: () => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  /** Open state per sidebar section id; absent = open. */
  sidebarSections: Record<string, boolean>;
  setSidebarSection: (id: string, open: boolean) => void;
  toggleSidebarSection: (id: string) => void;
  /** Whether the About dialog is requested (the dialog itself lands with item 8.2). */
  centerView: "graph" | "diff" | "blame";
  /** File shown by the blame view (`rev` undefined = working tree). */
  blameTarget: BlameTarget | null;
  showBlame: (repoId: RepoId, path: string, rev?: string) => void;
  showDiff: () => void;
  showGraph: () => void;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id" | "createdAt">) => string;
  dismissToast: (id: string) => void;
}

let nextId = 1;
const initialTheme = loadTheme();

export const useUiStore = create<UiState>((set, get) => ({
  theme: initialTheme,
  resolvedTheme: resolveTheme(initialTheme),
  setTheme: (theme) => {
    saveTheme(theme);
    set({ theme, resolvedTheme: resolveTheme(theme) });
  },
  refreshTheme: () => set({ resolvedTheme: resolveTheme(get().theme) }),
  sidebarOpen: loadSidebarOpen(),
  toggleSidebar: () => get().setSidebarOpen(!get().sidebarOpen),
  setSidebarOpen: (open) => {
    saveSidebarOpen(open);
    set({ sidebarOpen: open });
  },
  sidebarSections: loadSidebarSections(),
  setSidebarSection: (id, open) => {
    const next = { ...get().sidebarSections, [id]: open };
    saveSidebarSections(next);
    set({ sidebarSections: next });
  },
  toggleSidebarSection: (id) => get().setSidebarSection(id, get().sidebarSections[id] === false),
  centerView: "graph",
  blameTarget: null,
  showBlame: (repoId, path, rev) =>
    set({
      centerView: "blame",
      blameTarget: { repoId, path, ...(rev !== undefined ? { rev } : {}) },
    }),
  showDiff: () => set({ centerView: "diff" }),
  showGraph: () => set({ centerView: "graph", blameTarget: null }),
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
