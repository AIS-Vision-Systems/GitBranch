import { call } from "./core";
import type { AppInfo } from "./types";

export function appInfo(): Promise<AppInfo> {
  return call<AppInfo>("app_info");
}

/** Repo paths as given to `openRepo`, in tab order, plus the current one (null = "new tab" view). */
export interface Session {
  open: string[];
  current: string | null;
}

export const loadSession = (): Promise<Session> => call<Session>("load_session");
export const saveSession = (session: Session): Promise<void> =>
  call<void>("save_session", { session });
