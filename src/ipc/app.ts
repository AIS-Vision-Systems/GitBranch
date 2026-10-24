import { call } from "./core";
import type { AppInfo } from "./types";

export function appInfo(): Promise<AppInfo> {
  return call<AppInfo>("app_info");
}

/** Repo paths as given to `openRepo`, in tab order, plus the current one (null = "new tab" view). */
export interface Session {
  open: string[];
  current: string | null;
  /** Tab aliases keyed by repository path. */
  aliases: Record<string, string>;
}

export const loadSession = (): Promise<Session> => call<Session>("load_session");
export const saveSession = (session: Session): Promise<void> =>
  call<void>("save_session", { session });

/** Reveal the log folder in the OS file manager. */
export const openLogDir = (): Promise<void> => call<void>("open_log_dir");

/** Path queued by a second launch before the listener was ready; returns each path once, then null. */
export const takeLaunchPath = (): Promise<string | null> => call<string | null>("take_launch_path");
