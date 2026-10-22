import { call } from "./core";
import type { PullMode } from "./remote";
import type { RepoId } from "./types";

export interface Settings {
  gitPath: string | null;
  pullStrategy: PullMode;
  /** 0..100. */
  diffContextLines: number;
  diffIgnoreWhitespace: boolean;
  editor: string | null;
  terminal: string | null;
  difftool: string | null;
  autoUpdateCheck: boolean;
}

export function getSettings(): Promise<Settings> {
  return call<Settings>("get_settings");
}

/** Rejects (IPC error) when `gitPath` does not exist. */
export function setSettings(settings: Settings): Promise<Settings> {
  return call<Settings>("set_settings", { settings });
}

/** Open the file's diff in the configured external difftool; errors if none is configured. */
export function openDifftool(
  repoId: RepoId,
  path: string,
  staged: boolean,
  rev?: string,
): Promise<void> {
  return call<void>("open_difftool", { repoId, path, staged, rev });
}
