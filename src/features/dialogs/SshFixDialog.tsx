import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { isIpcError } from "../../ipc/core";
import {
  sshAddKey,
  sshEnableWindowsAgent,
  sshReport,
  sshTestRemote,
  sshUseWindowsOpenssh,
  type SshKey,
  type SshReport,
} from "../../ipc/ssh";
import type { RepoId } from "../../ipc/types";
import { githubHttpsUrlOf } from "../../lib/remoteUrl";
import { confirm } from "../../state/dialogs";
import { useGithubStore } from "../../state/github";
import { switchToHttps } from "../../state/ops";
import { remotesOf, useRemotesStore } from "../../state/remotes";
import { Dialog } from "../shell/Dialog";
import { openSshFix } from "./open";
import styles from "./SshFixDialog.module.css";

export interface SshFixDialogProps {
  repoId: RepoId | null;
  remote: string | null;
  onClose: () => void;
}

const errMessage = (e: unknown): string =>
  isIpcError(e) ? e.error.message : e instanceof Error ? e.message : String(e);

const errCode = (e: unknown): string | null => (isIpcError(e) ? e.error.code : null);

function keyError(e: unknown): string {
  switch (errCode(e)) {
    case "ssh.bad_passphrase":
      return "Wrong passphrase";
    case "ssh.no_agent":
      return "The agent is not running";
    case "ssh.bad_permissions":
      return `Windows refuses a key file that other users can read. ${errMessage(e)}`;
    case null:
    default:
      return errMessage(e);
  }
}

const fileName = (p: string): string => p.split(/[\\/]/).pop() ?? p;

function Step({ done, title, children }: { done: boolean; title: string; children?: ReactNode }) {
  return (
    <div className={styles["step"]}>
      <div className={styles["head"]}>
        <span
          className={`${styles["mark"]} ${done ? styles["done"] : styles["pending"]}`}
          role="img"
          aria-label={done ? "Done" : "Pending"}
        >
          {done ? "✓" : "○"}
        </span>
        {title}
      </div>
      {children}
    </div>
  );
}

function KeyRow({
  k,
  agentReady,
  onLoaded,
}: {
  k: SshKey;
  agentReady: boolean;
  onLoaded: () => void;
}) {
  // The passphrase lives only here and is cleared right after the call.
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = async (): Promise<void> => {
    if (k.badPermissions || (k.encrypted && passphrase === "")) return;
    const pass = k.encrypted ? passphrase : null;
    setBusy(true);
    setError(null);
    try {
      await sshAddKey(k.path, pass);
      onLoaded();
    } catch (e) {
      if (alive.current) setError(keyError(e));
    } finally {
      if (alive.current) {
        setPassphrase("");
        setBusy(false);
      }
    }
  };

  const label = `${k.kind}${k.comment !== "" ? ` ${k.comment}` : ""} (${fileName(k.path)})`;
  return (
    <div className={styles["key"]}>
      <div className={styles["head"]}>
        <span
          className={`${styles["mark"]} ${k.loaded ? styles["done"] : styles["pending"]}`}
          role="img"
          aria-label={k.loaded ? "Loaded" : "Not loaded"}
        >
          {k.loaded ? "✓" : "○"}
        </span>
        <span>{label}</span>
      </div>
      <div className={`${styles["note"]} ${styles["mono"]}`}>{k.fingerprint.slice(0, 24)}</div>
      {k.loaded ? (
        <div className={styles["note"]}>Loaded in the agent</div>
      ) : (
        <div className={styles["row"]}>
          {k.encrypted && (
            <input
              className={styles["input"]}
              type="password"
              autoComplete="off"
              aria-label={`Passphrase for ${fileName(k.path)}`}
              placeholder="Key passphrase"
              value={passphrase}
              disabled={busy}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && agentReady && !busy && !k.badPermissions) {
                  e.preventDefault();
                  void load();
                }
              }}
            />
          )}
          <button
            type="button"
            className={styles["btn"]}
            disabled={busy || !agentReady || k.badPermissions || (k.encrypted && passphrase === "")}
            title={agentReady ? undefined : "The agent is not ready yet"}
            aria-label={`Load ${fileName(k.path)}`}
            onClick={() => void load()}
          >
            {busy ? "Loading…" : "Load"}
          </button>
        </div>
      )}
      {!k.loaded && k.badPermissions && (
        <div className={styles["error"]}>
          Windows refuses a key file that other users can read. Remove the other users from the
          file&apos;s permissions (Properties › Security), then reopen this dialog.
        </div>
      )}
      {!k.loaded && !agentReady && (
        <div className={styles["note"]}>Fix the agent above before loading keys.</div>
      )}
      {error !== null && (
        <div className={styles["error"]} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export function SshFixDialog({ repoId, remote, onClose }: SshFixDialogProps) {
  const [report, setReport] = useState<SshReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [connected, setConnected] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const account = useGithubStore((s) => s.account);
  const remotes = useRemotesStore((s) => (repoId === null ? NONE : remotesOf(s, repoId)));
  const remoteObj = remote === null ? undefined : remotes.find((r) => r.name === remote);
  const canHttps =
    remoteObj !== undefined &&
    githubHttpsUrlOf(remoteObj.fetchUrl) !== null &&
    account !== null &&
    account !== undefined;

  const reload = useCallback(async (): Promise<void> => {
    try {
      const r = await sshReport(repoId);
      if (!mounted.current) return;
      setReport(r);
      setLoadError(null);
    } catch (e) {
      if (mounted.current) setLoadError(errMessage(e));
    }
  }, [repoId]);

  useEffect(() => {
    // Initial load; setState happens in the promise callback.
    sshReport(repoId).then(
      (r) => {
        if (mounted.current) setReport(r);
      },
      (e: unknown) => {
        if (mounted.current) setLoadError(errMessage(e));
      },
    );
  }, [repoId]);

  const setErr = (key: string, msg: string | null): void => {
    if (!mounted.current) return;
    setErrors((prev) => {
      const next = { ...prev };
      if (msg === null) delete next[key];
      else next[key] = msg;
      return next;
    });
  };

  const runStep = async (key: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(key);
    setErr(key, null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setErr(key, errCode(e) === "ssh.cancelled" ? "Cancelled" : errMessage(e));
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const applyWindowsOpenssh = async (): Promise<void> => {
    const target = report?.windowsSshCommand ?? null;
    if (target === null) return;
    const replaced =
      report?.sshCommand != null && report.sshCommand !== target
        ? ` It replaces the current setting (${report.sshCommand}).`
        : "";
    // The confirm dialog replaces this one; reopen it afterwards with a fresh report.
    await confirm({
      title: "Use the Windows SSH client",
      message: `Make Git use the Windows OpenSSH client, which talks to the Windows SSH agent.${replaced}`,
      command: `git config --global core.sshCommand ${target}`,
      confirmLabel: "Apply",
      onConfirm: async () => {
        await sshUseWindowsOpenssh();
      },
    });
    openSshFix(repoId, remote);
  };

  const testConnection = async (): Promise<void> => {
    if (repoId === null || remote === null) return;
    setConnected(false);
    setBusy("test");
    setErr("test", null);
    try {
      await sshTestRemote(repoId, remote);
      if (mounted.current) setConnected(true);
    } catch (e) {
      setErr("test", errMessage(e));
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const agentReady = report?.agent.kind === "ready";
  const wa = report?.windowsAgent ?? null;

  return (
    <Dialog
      title="Fix SSH"
      onClose={onClose}
      width="lg"
      footer={
        <button type="button" className={styles["btn"]} onClick={onClose}>
          Close
        </button>
      }
    >
      {report === null ? (
        loadError !== null ? (
          <div className={styles["error"]} role="alert">
            {loadError}
          </div>
        ) : (
          <div className={styles["note"]}>Checking your SSH setup…</div>
        )
      ) : (
        <div className={styles["steps"]}>
          {report.windows && (
            <>
              <Step done={wa === "running"} title="SSH agent service">
                {wa === "missing" ? (
                  <div className={styles["note"]}>
                    The Windows OpenSSH client feature is not installed. Add it in Settings › System
                    › Optional features › OpenSSH Client.
                  </div>
                ) : wa !== "running" ? (
                  <div className={styles["row"]}>
                    <button
                      type="button"
                      className={styles["btn"]}
                      disabled={busy !== null}
                      onClick={() => void runStep("agent", sshEnableWindowsAgent)}
                    >
                      {busy === "agent" ? "Enabling…" : "Enable agent"}
                    </button>
                    <span className={styles["note"]}>
                      Windows asks for administrator permission
                    </span>
                  </div>
                ) : null}
                {errors["agent"] !== undefined && (
                  <div className={styles["error"]} role="alert">
                    {errors["agent"]}
                  </div>
                )}
              </Step>
              <Step done={report.usesWindowsOpenssh} title="Git uses the Windows SSH client">
                {report.sshCommandScope === "local" && (
                  <div className={styles["note"]}>
                    This repository overrides it with its own core.sshCommand, so the global setting
                    will not apply here (it still fixes your other repositories).
                  </div>
                )}
                {report.sshCommandScope === "env" && (
                  <div className={styles["note"]}>
                    GIT_SSH_COMMAND or GIT_SSH in the environment wins over Git&apos;s
                    configuration.
                  </div>
                )}
                {!report.usesWindowsOpenssh && report.windowsSshCommand !== null && (
                  <div className={styles["row"]}>
                    <button
                      type="button"
                      className={styles["btn"]}
                      disabled={busy !== null}
                      onClick={() => void applyWindowsOpenssh()}
                    >
                      Use it
                    </button>
                    <span className={styles["note"]}>
                      Git&apos;s own ssh cannot see the Windows agent.
                    </span>
                  </div>
                )}
              </Step>
            </>
          )}
          {!report.windows && (
            <Step done={agentReady} title="SSH agent">
              {!agentReady && (
                <div className={styles["note"]}>
                  No SSH agent is reachable from GitBranch (SSH_AUTH_SOCK is not set). Start one
                  with your desktop session, for example GNOME Keyring, then reopen this dialog.
                </div>
              )}
            </Step>
          )}
          <Step done={report.keys.some((k) => k.loaded)} title="Keys">
            {report.toolsError !== null ? (
              <div className={styles["error"]}>{report.toolsError}</div>
            ) : report.keys.length === 0 ? (
              <div className={styles["note"]}>
                There is no SSH key in ~/.ssh. Create one, or use HTTPS instead.
              </div>
            ) : (
              report.keys.map((k) => (
                <KeyRow key={k.path} k={k} agentReady={agentReady} onLoaded={() => void reload()} />
              ))
            )}
          </Step>
          {repoId !== null && remote !== null && (
            <Step done={connected} title="Test connection">
              <div className={styles["row"]}>
                <button
                  type="button"
                  className={styles["btn"]}
                  disabled={busy !== null}
                  onClick={() => void testConnection()}
                >
                  {busy === "test" ? "Testing…" : "Test connection"}
                </button>
                {connected && <span className={styles["note"]}>Connected to {remote}</span>}
              </div>
              {errors["test"] !== undefined && (
                <div className={styles["error"]} role="alert">
                  {errors["test"]}
                </div>
              )}
            </Step>
          )}
          {canHttps && repoId !== null && remoteObj !== undefined && (
            <div className={styles["step"]}>
              <div className={styles["head"]}>Or use HTTPS</div>
              <div className={styles["row"]}>
                <button
                  type="button"
                  className={styles["btn"]}
                  disabled={busy !== null}
                  onClick={() => {
                    void switchToHttps(repoId, remoteObj).then((ok) => {
                      if (ok && mounted.current) onClose();
                    });
                  }}
                >
                  Use HTTPS for {remoteObj.name}
                </button>
                <span className={styles["note"]}>Uses your GitHub sign-in instead of a key.</span>
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

const NONE: never[] = [];
