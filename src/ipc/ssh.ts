import { call } from "./core";
import type { RepoId } from "./types";

export type WindowsAgentState = "running" | "stopped" | "disabled" | "missing";

export interface SshKey {
  path: string;
  kind: string;
  fingerprint: string;
  comment: string;
  encrypted: boolean;
  badPermissions: boolean;
  loaded: boolean;
}

export interface SshReport {
  windows: boolean;
  sshCommand: string | null;
  sshCommandScope: "global" | "local" | "system" | "env" | null;
  usesWindowsOpenssh: boolean;
  /** Exact value `ssh_use_windows_openssh` writes (Windows only). */
  windowsSshCommand: string | null;
  /** null off Windows. */
  windowsAgent: WindowsAgentState | null;
  agent: { kind: "ready"; keys: number } | { kind: "unreachable" };
  keys: SshKey[];
  /** ssh-keygen/ssh-add could not run (e.g. the Windows OpenSSH client is not installed). */
  toolsError: string | null;
}

export const sshReport = (repoId: RepoId | null): Promise<SshReport> =>
  call("ssh_report", { repoId });

/** Shows a Windows UAC prompt; rejects with `ssh.cancelled` when declined. */
export const sshEnableWindowsAgent = (): Promise<void> => call("ssh_enable_windows_agent");

export const sshUseWindowsOpenssh = (): Promise<void> => call("ssh_use_windows_openssh");

/** The passphrase is only forwarded; callers must never store or log it. */
export const sshAddKey = (path: string, passphrase: string | null): Promise<void> =>
  call("ssh_add_key", { path, passphrase });

export const sshTestRemote = (repoId: RepoId, remote: string): Promise<void> =>
  call("ssh_test_remote", { repoId, remote });
