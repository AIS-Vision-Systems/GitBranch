import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { call } from "./core";

export interface AvailableUpdate {
  version: string;
  notes?: string;
  /** Downloads and installs; `onProgress` receives 0..100 when the size is known. */
  downloadAndInstall: (onProgress: (percent: number) => void) => Promise<void>;
}

/** Resolves null when already up to date. */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  const update = await check();
  if (update === null) return null;
  const result: AvailableUpdate = {
    version: update.version,
    downloadAndInstall: async (onProgress) => {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress") {
          done += e.data.chunkLength;
          if (total > 0) onProgress(Math.min(100, Math.round((done / total) * 100)));
        } else onProgress(100);
      });
    },
  };
  if (update.body !== undefined) result.notes = update.body;
  return result;
}

export function restartApp(): Promise<void> {
  return relaunch();
}

/** False for installs that cannot replace themselves (.deb): notify only. */
export function canSelfUpdate(): Promise<boolean> {
  return call<boolean>("can_self_update");
}
