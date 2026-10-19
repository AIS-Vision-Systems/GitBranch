import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { GithubDeviceCode } from "../../ipc/github";
import { useGithubStore } from "../../state/github";
import { Dialog } from "../shell/Dialog";
import form from "../dialogs/Form.module.css";
import styles from "./github.module.css";

export interface LoginDialogProps {
  onClose: () => void;
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function CodeStep({ code, startedAt }: { code: GithubDeviceCode; startedAt: number }) {
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = (): void => {
    void navigator.clipboard.writeText(code.userCode).then(() => {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    });
  };
  const remaining = startedAt + code.expiresIn * 1000 - now;

  return (
    <div className={styles["loginBody"]}>
      <div className={form["hint"]}>Enter this code at</div>
      <div className={styles["codeRow"]}>
        <code className={styles["code"]} aria-label="Device code">
          {code.userCode}
        </code>
        <button type="button" className={form["cancel"]} onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <button
        type="button"
        className={form["cancel"]}
        onClick={() => void openUrl(code.verificationUri)}
      >
        Open github.com
      </button>
      <div className={styles["waiting"]}>
        <span className={styles["dot"]} aria-hidden="true" />
        <span>Waiting for you to authorize in the browser…</span>
      </div>
      <div className={form["hint"]}>Code expires in {formatCountdown(remaining)}</div>
    </div>
  );
}

export function LoginDialog({ onClose }: LoginDialogProps) {
  const login = useGithubStore((s) => s.login);
  const startLogin = useGithubStore((s) => s.startLogin);
  const cancelLogin = useGithubStore((s) => s.cancelLogin);
  const resetLogin = useGithubStore((s) => s.resetLogin);
  const [workflow, setWorkflow] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const step = login.step;

  // Login finished while open: close (and leave the store idle for the next open).
  useEffect(() => {
    if (step === "done") {
      resetLogin();
      onClose();
    }
  }, [step, resetLogin, onClose]);

  useEffect(() => {
    primaryRef.current?.focus();
  }, [step]);

  const cancel = (): void => {
    if (step === "code" || step === "starting") void cancelLogin();
    else if (step === "error") resetLogin();
    onClose();
  };

  let body;
  let footer;
  if (login.step === "code") {
    body = <CodeStep code={login.code} startedAt={login.startedAt} />;
    footer = (
      <button ref={primaryRef} type="button" className={form["cancel"]} onClick={cancel}>
        Cancel
      </button>
    );
  } else if (login.step === "error") {
    body = (
      <div className={form["error"]} role="alert">
        {login.message}
      </div>
    );
    footer = (
      <>
        <button type="button" className={form["cancel"]} onClick={cancel}>
          Close
        </button>
        <button ref={primaryRef} type="button" className={form["submit"]} onClick={resetLogin}>
          Try again
        </button>
      </>
    );
  } else {
    const starting = login.step === "starting";
    body = (
      <div className={styles["loginBody"]}>
        <div>Sign in to GitHub with a one-time code.</div>
        <label className={form["check"]}>
          <input
            type="checkbox"
            checked={workflow}
            disabled={starting}
            onChange={(e) => setWorkflow(e.target.checked)}
          />
          <span>
            Also allow workflow files (<code>workflow</code> scope)
          </span>
        </label>
      </div>
    );
    footer = (
      <>
        <button type="button" className={form["cancel"]} onClick={cancel}>
          Cancel
        </button>
        <button
          ref={primaryRef}
          type="button"
          className={form["submit"]}
          disabled={starting}
          onClick={() => void startLogin(workflow)}
        >
          Continue
        </button>
      </>
    );
  }

  return (
    <Dialog
      title="Sign in to GitHub"
      onClose={cancel}
      width="sm"
      initialFocusRef={primaryRef}
      footer={footer}
    >
      {body}
    </Dialog>
  );
}
