import { create } from "zustand";
import * as ipc from "../ipc/settings";
import type { Settings } from "../ipc/settings";
import { isIpcError } from "../ipc/core";

export const DEFAULT_SETTINGS: Settings = {
  gitPath: null,
  pullStrategy: "config",
  diffContextLines: 3,
  diffIgnoreWhitespace: false,
  editor: null,
  difftool: null,
  autoUpdateCheck: true,
};

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  /** Merge `partial` into the settings and persist. Resolves true on success. */
  save: (partial: Partial<Settings>) => Promise<boolean>;
  clearError: () => void;
}

function message(e: unknown): string {
  if (isIpcError(e)) return e.error.message;
  return e instanceof Error ? e.message : String(e);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  error: null,
  load: async () => {
    try {
      set({ settings: await ipc.getSettings(), loaded: true, error: null });
    } catch (e) {
      set({ error: message(e) });
    }
  },
  save: async (partial) => {
    try {
      const settings = await ipc.setSettings({ ...get().settings, ...partial });
      set({ settings, error: null });
      return true;
    } catch (e) {
      set({ error: message(e) });
      return false;
    }
  },
  clearError: () => set({ error: null }),
}));
