import { call } from "./core";
import type { AppInfo } from "./types";

export function appInfo(): Promise<AppInfo> {
  return call<AppInfo>("app_info");
}
