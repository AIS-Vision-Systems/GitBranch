import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GITHUB_REVOKE_URL } from "../../ipc/github";
import { gitIdentity, setGitIdentity, type ConfigScope, type Identity } from "../../ipc/identity";
import type { RepoId } from "../../ipc/types";
import { useIdentityStore } from "../../state/identity";
import { useAvatar } from "./useAvatar";
import { CircleUser } from "../../lib/icons";
import { useNow } from "../../lib/useNow";
import { describeProblem, formatClock } from "../../lib/githubErrors";
import { useGithubStore } from "../../state/github";
import { useReposStore } from "../../state/repos";
import { reportError } from "../../state/ui";
import { openGithubLogin } from "../dialogs/open";
import appStyles from "../../App.module.css";
import styles from "./AccountMenu.module.css";

const PROFILE_SETTINGS_URL = "https://github.com/settings/profile";

function initialsOf(name: string | null, login: string): string {
  const source = name !== null && name.trim() !== "" ? name.trim() : login;
  const parts = source.split(/[\s_-]+/).filter((p) => p !== "");
  const letters =
    parts.length >= 2 ? (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "") : source.slice(0, 2);
  return letters.toUpperCase();
}

function Avatar({
  url,
  fallback,
  large,
}: {
  url: string | null;
  fallback: string;
  large?: boolean;
}) {
  const cls = large ? styles["avatarLg"] : styles["avatarSm"];
  return url !== null ? (
    <img className={cls} src={url} alt="" data-testid="github-avatar" />
  ) : (
    <span className={cls} aria-hidden="true" data-testid="github-avatar-fallback">
      {fallback}
    </span>
  );
}

function ScopeTag({ scope }: { scope: string }) {
  return <span className={styles["tag"]}>{scope}</span>;
}

function SignatureSection({ repoId }: { repoId: RepoId }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [scope, setScope] = useState<ConfigScope>("global");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setIdentity(await gitIdentity(repoId));
    } catch (e) {
      reportError(e, "Could not load the commit identity");
    }
  }, [repoId]);

  useEffect(() => {
    let live = true;
    gitIdentity(repoId)
      .then((id) => {
        if (live) setIdentity(id);
      })
      .catch((e: unknown) => reportError(e, "Could not load the commit identity"));
    return () => {
      live = false;
    };
  }, [repoId]);

  const startEdit = (): void => {
    setName(identity?.name?.value ?? "");
    setEmail(identity?.email?.value ?? "");
    setScope(identity?.name?.scope === "local" ? "local" : "global");
    setEditing(true);
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await setGitIdentity(repoId, scope, name.trim(), email.trim());
      setEditing(false);
      void useIdentityStore.getState().load(repoId, true);
      await load();
    } catch (e) {
      reportError(e, "Could not save the commit identity");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles["section"]} aria-label="Commit signature">
      <div className={styles["sectionTitle"]}>Commit signature</div>
      {editing ? (
        <>
          <label className={styles["field"]}>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className={styles["field"]}>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <fieldset className={styles["scopeChoice"]}>
            <legend className={styles["sr"]}>Scope</legend>
            <label>
              <input
                type="radio"
                name="identity-scope"
                checked={scope === "local"}
                onChange={() => setScope("local")}
              />{" "}
              This repository
            </label>
            <label>
              <input
                type="radio"
                name="identity-scope"
                checked={scope === "global"}
                onChange={() => setScope("global")}
              />{" "}
              Globally
            </label>
          </fieldset>
          <div className={styles["actions"]}>
            <button
              type="button"
              className={styles["item"]}
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles["item"]}
              disabled={busy}
              onClick={() => void save()}
            >
              Save
            </button>
          </div>
        </>
      ) : (
        <>
          {(["name", "email"] as const).map((k) => {
            const v = identity?.[k] ?? null;
            return (
              <div key={k} className={styles["row"]}>
                <span className={styles["value"]}>
                  {v !== null ? v.value : <span className={styles["muted"]}>not set</span>}
                </span>
                {v !== null && <ScopeTag scope={v.scope} />}
              </div>
            );
          })}
          <button type="button" className={styles["link"]} onClick={startEdit}>
            Edit
          </button>
        </>
      )}
    </section>
  );
}

export function AccountMenu() {
  const account = useGithubStore((s) => s.account);
  const refresh = useGithubStore((s) => s.refresh);
  const logout = useGithubStore((s) => s.logout);
  const status = useGithubStore((s) => s.status);
  const loadStatus = useGithubStore((s) => s.loadStatus);
  const repoId = useReposStore((s) => s.currentId);
  const [open, setOpen] = useState(false);
  const nowMs = useNow(open || status?.rateLimitedUntil != null ? 15000 : null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const avatar = useAvatar(account ? account.user.login : null);

  useEffect(() => {
    if (open) popoverRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [open]);

  useEffect(() => {
    if (open) void loadStatus();
  }, [open, loadStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!account) {
    return (
      <button
        type="button"
        className={`${appStyles["themeButton"]} ${styles["trigger"]}`}
        onClick={openGithubLogin}
      >
        <CircleUser size={18} aria-hidden="true" />
        Sign in to GitHub
      </button>
    );
  }

  const limitedUntil =
    status?.rateLimitedUntil != null && status.rateLimitedUntil * 1000 > nowMs
      ? status.rateLimitedUntil
      : null;
  const offline = limitedUntil === null && (account.offline || status?.online === false);
  const { user, scopes } = account;
  const rl = status?.rateLimit ?? null;
  const warning: string | null =
    limitedUntil !== null
      ? describeProblem({ kind: "rateLimited", resetAt: limitedUntil }, nowMs)
      : offline
        ? describeProblem({ kind: "offline" })
        : null;
  const initials = initialsOf(user.name, user.login);
  return (
    <div className={styles["wrap"]} ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`${appStyles["themeButton"]} ${styles["trigger"]}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Account ${user.login}`}
        title={warning ?? undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar url={avatar} fallback={initials} />
        {warning !== null && (
          <span className={styles["warnDot"]} data-testid="github-warning-dot" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div
          ref={popoverRef}
          className={styles["popover"]}
          role="dialog"
          aria-label="GitHub account"
        >
          <div className={styles["header"]}>
            <Avatar url={avatar} fallback={initials} large />
            <div className={styles["headerText"]}>
              <span className={styles["name"]}>{user.name ?? user.login}</span>
              <span className={styles["muted"]}>@{user.login}</span>
              <button
                type="button"
                className={styles["link"]}
                onClick={() => void openUrl(user.htmlUrl)}
              >
                View profile
              </button>
            </div>
          </div>
          {repoId !== null && <SignatureSection repoId={repoId as RepoId} />}
          <section className={styles["section"]} aria-label="Account">
            <div className={styles["sectionTitle"]}>Account</div>
            <div className={styles["row"]}>
              <span className={styles["muted"]}>Name</span>
              <span className={styles["value"]}>{user.name ?? user.login}</span>
            </div>
            <div className={styles["row"]}>
              <span className={styles["muted"]}>Email</span>
              <span className={user.email === null ? styles["muted"] : styles["value"]}>
                {user.email ?? "not public"}
              </span>
            </div>
            {limitedUntil !== null && (
              <div className={`${styles["statusLine"]} ${styles["statusWarn"]}`}>
                Rate limited until {formatClock(limitedUntil)}
              </div>
            )}
            {rl !== null && (
              <div className={styles["statusLine"]}>
                API: {rl.remaining} of {rl.limit} requests left, resets {formatClock(rl.reset)}
              </div>
            )}
            {account.offline ? (
              <div className={styles["muted"]}>scopes unknown (offline)</div>
            ) : (
              <div className={styles["chips"]}>
                {scopes.map((s) => (
                  <span key={s} className={styles["chip"]}>
                    {s}
                  </span>
                ))}
              </div>
            )}
          </section>
          <div className={styles["buttons"]}>
            <button
              type="button"
              className={styles["item"]}
              onClick={() => void openUrl(PROFILE_SETTINGS_URL)}
            >
              Manage account
            </button>
            <button
              type="button"
              className={styles["item"]}
              onClick={() => {
                setOpen(false);
                openGithubLogin();
              }}
            >
              Re-authorize…
            </button>
            <button
              type="button"
              className={styles["item"]}
              onClick={() => {
                setOpen(false);
                void logout();
              }}
            >
              Sign out
            </button>
            <button
              type="button"
              className={styles["item"]}
              title="Sign out first removes the token from this computer; revoking on GitHub invalidates it everywhere"
              onClick={() => void openUrl(GITHUB_REVOKE_URL)}
            >
              Revoke on GitHub…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
