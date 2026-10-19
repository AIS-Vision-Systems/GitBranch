import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GITHUB_REVOKE_URL } from "../../ipc/github";
import { useGithubStore } from "../../state/github";
import { openGithubLogin } from "../dialogs/open";
import appStyles from "../../App.module.css";
import styles from "./github.module.css";

function initialsOf(name: string | null, login: string): string {
  const source = name !== null && name.trim() !== "" ? name.trim() : login;
  const parts = source.split(/[\s_-]+/).filter((p) => p !== "");
  const letters =
    parts.length >= 2 ? (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "") : source.slice(0, 2);
  return letters.toUpperCase();
}

export function AccountMenu() {
  const account = useGithubStore((s) => s.account);
  const refresh = useGithubStore((s) => s.refresh);
  const logout = useGithubStore((s) => s.logout);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) popoverRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [open]);

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
      <button type="button" className={appStyles["themeButton"]} onClick={openGithubLogin}>
        Sign in to GitHub
      </button>
    );
  }

  const { user, scopes, offline } = account;
  return (
    <div className={styles["wrap"]} ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={appStyles["themeButton"]}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={offline ? "GitHub unreachable; showing the stored account" : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles["avatar"]} aria-hidden="true">
          {initialsOf(user.name, user.login)}
        </span>
        {user.login}
        {offline && <span className={styles["muted"]}> (offline)</span>}
      </button>
      {open && (
        <div
          ref={popoverRef}
          className={styles["popover"]}
          role="dialog"
          aria-label="GitHub account"
        >
          <div className={styles["name"]}>{user.name ?? user.login}</div>
          <button
            type="button"
            className={styles["link"]}
            onClick={() => void openUrl(user.htmlUrl)}
          >
            @{user.login}
          </button>
          {offline ? (
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
      )}
    </div>
  );
}
