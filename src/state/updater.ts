import { create } from "zustand";
import * as ipc from "../ipc/updater";
import type { AvailableUpdate } from "../ipc/updater";
import { isIpcError } from "../ipc/core";
import { useSettingsStore } from "./settings";

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

export const LAST_CHECK_KEY = "gitbranch.updateLastCheck";
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** The timer polls hourly; the 24 h throttle decides whether a check actually runs. */
export const TIMER_INTERVAL_MS = 60 * 60 * 1000;
export const FIRST_CHECK_DELAY_MS = 5000;

function lastCheck(): number {
  try {
    const n = Number(localStorage.getItem(LAST_CHECK_KEY));
    return Number.isFinite(n) && n <= Date.now() ? n : 0;
  } catch {
    return 0;
  }
}

function markChecked(): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

function message(e: unknown): string {
  if (isIpcError(e)) return e.error.message;
  return e instanceof Error ? e.message : String(e);
}

interface UpdaterState {
  status: UpdateStatus;
  /** 0..100 while downloading. */
  progress: number;
  version: string | null;
  notes: string | null;
  error: string | null;
  /** Set by a manual check that found nothing. */
  upToDate: boolean;
  /** "Later" pressed: hidden until next launch. */
  dismissed: boolean;
  selfUpdate: boolean;
  check: (opts?: { manual?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}

let pending: AvailableUpdate | null = null;

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  progress: 0,
  version: null,
  notes: null,
  error: null,
  upToDate: false,
  dismissed: false,
  selfUpdate: true,
  check: async (opts) => {
    const manual = opts?.manual === true;
    const { status } = get();
    if (status === "checking" || status === "downloading" || status === "ready") return;
    if (!manual) {
      const s = useSettingsStore.getState();
      if (!s.loaded || !s.settings.autoUpdateCheck) return;
      if (status === "available") return;
      if (Date.now() - lastCheck() < CHECK_INTERVAL_MS) return;
    }
    set({ status: "checking", error: null, upToDate: false });
    try {
      const update = await ipc.checkForUpdate();
      markChecked();
      if (update === null) {
        pending = null;
        set({ status: "idle", upToDate: manual });
        return;
      }
      let selfUpdate = true;
      try {
        selfUpdate = await ipc.canSelfUpdate();
      } catch {
        /* assume it can */
      }
      pending = update;
      set({
        status: "available",
        version: update.version,
        notes: update.notes ?? null,
        selfUpdate,
        progress: 0,
        dismissed: manual ? false : get().dismissed,
      });
    } catch (e) {
      pending = null;
      if (manual) set({ status: "error", error: message(e), version: null, notes: null });
      else {
        console.debug("automatic update check failed", e);
        set({ status: "idle", version: null, notes: null });
      }
    }
  },
  install: async () => {
    const update = pending;
    const st = get().status;
    if (update === null || (st !== "available" && st !== "error") || !get().selfUpdate) return;
    set({ status: "downloading", progress: 0, error: null });
    try {
      await update.downloadAndInstall((p) => set({ progress: p }));
      set({ status: "ready", progress: 100 });
      await ipc.restartApp();
    } catch (e) {
      set({ status: "error", error: message(e) });
    }
  },
  dismiss: () => set({ dismissed: true }),
}));

/** First check shortly after startup, then daily while running. Returns a stop function. */
export function startUpdateScheduler(): () => void {
  const run = (): void => void useUpdaterStore.getState().check();
  const first = setTimeout(run, FIRST_CHECK_DELAY_MS);
  const every = setInterval(run, TIMER_INTERVAL_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
