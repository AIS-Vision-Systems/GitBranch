import { useRef, useState } from "react";
import { openLogDir } from "../../ipc/app";
import type { RepoId } from "../../ipc/types";
import type { Settings } from "../../ipc/settings";
import type { PullMode } from "../../ipc/remote";
import { useDetailsStore } from "../../state/details";
import { useSettingsStore } from "../../state/settings";
import { reportError, useUiStore, type Theme } from "../../state/ui";
import { useReposStore } from "../../state/repos";
import { useUpdaterStore } from "../../state/updater";
import { FormDialog } from "./FormDialog";
import styles from "./Form.module.css";

export interface SettingsDialogProps {
  onClose: () => void;
}

const THEMES: Theme[] = ["system", "light", "dark"];
const PULL: { mode: PullMode; label: string }[] = [
  { mode: "config", label: "Repository default (git config)" },
  { mode: "ffOnly", label: "Fast-forward only" },
  { mode: "rebase", label: "Rebase" },
  { mode: "merge", label: "Merge" },
];

/** Clamp to the 0..100 range the backend accepts. */
function clampContext(n: number): number {
  if (!Number.isFinite(n)) return 3;
  return Math.min(100, Math.max(0, Math.trunc(n)));
}

const orNull = (s: string): string | null => (s.trim() === "" ? null : s.trim());

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const current = useSettingsStore((s) => s.settings);
  const error = useSettingsStore((s) => s.error);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const [gitPath, setGitPath] = useState(current.gitPath ?? "");
  const [pull, setPull] = useState<PullMode>(current.pullStrategy);
  const [ctx, setCtx] = useState(String(current.diffContextLines));
  const [ws, setWs] = useState(current.diffIgnoreWhitespace);
  const [editor, setEditor] = useState(current.editor ?? "");
  const [difftool, setDifftool] = useState(current.difftool ?? "");
  const [auto, setAuto] = useState(current.autoUpdateCheck);
  const upd = useUpdaterStore();
  const selectRef = useRef<HTMLSelectElement>(null);
  const ctxNum = Number(ctx);
  const valid = ctx.trim() !== "" && Number.isInteger(ctxNum) && ctxNum >= 0 && ctxNum <= 100;

  const submit = async (): Promise<boolean> => {
    useSettingsStore.getState().clearError();
    const next: Partial<Settings> = {
      gitPath: orNull(gitPath),
      pullStrategy: pull,
      diffContextLines: clampContext(ctxNum),
      diffIgnoreWhitespace: ws,
      editor: orNull(editor),
      difftool: orNull(difftool),
      autoUpdateCheck: auto,
    };
    const diffChanged =
      next.diffContextLines !== current.diffContextLines ||
      next.diffIgnoreWhitespace !== current.diffIgnoreWhitespace;
    const ok = await useSettingsStore.getState().save(next);
    if (ok && diffChanged) {
      const d = useDetailsStore.getState();
      const repoId = useReposStore.getState().currentId as RepoId | null;
      if (d.selectedFile !== null && repoId !== null) {
        void d.reloadFile(repoId, d.selectedFile.target, d.selectedFile.label);
      }
    }
    return ok;
  };

  return (
    <FormDialog
      title="Settings"
      submitLabel="Save"
      valid={valid}
      initialFocusRef={selectRef}
      onClose={onClose}
      onSubmit={submit}
    >
      <strong>General</strong>
      <label className={styles["field"]}>
        <span className={styles["label"]}>Theme</span>
        <select
          ref={selectRef}
          className={styles["select"]}
          value={theme}
          onChange={(e) => setTheme(e.target.value as Theme)}
        >
          {THEMES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className={styles["field"]}>
        <span className={styles["label"]}>Git executable path</span>
        <input
          className={styles["input"]}
          value={gitPath}
          placeholder="Auto-detect"
          onChange={(e) => setGitPath(e.target.value)}
        />
        <span className={styles["hint"]}>Applies after restart.</span>
      </label>
      <strong>Git</strong>
      {PULL.map((m) => (
        <label key={m.mode} className={styles["radio"]}>
          <input
            type="radio"
            name="settings-pull"
            checked={pull === m.mode}
            onChange={() => setPull(m.mode)}
          />
          <span className={styles["radioText"]}>{m.label}</span>
        </label>
      ))}
      <strong>Diff</strong>
      <label className={styles["field"]}>
        <span className={styles["label"]}>Context lines (0-100)</span>
        <input
          className={styles["input"]}
          type="number"
          min={0}
          max={100}
          value={ctx}
          onChange={(e) => setCtx(e.target.value)}
        />
      </label>
      <label className={styles["check"]}>
        <input type="checkbox" checked={ws} onChange={(e) => setWs(e.target.checked)} />
        <span>Ignore whitespace</span>
      </label>
      <strong>Tools</strong>
      <label className={styles["field"]}>
        <span className={styles["label"]}>External editor command</span>
        <input
          className={styles["input"]}
          value={editor}
          placeholder="e.g. code"
          onChange={(e) => setEditor(e.target.value)}
        />
      </label>
      <label className={styles["field"]}>
        <span className={styles["label"]}>Difftool command</span>
        <input
          className={styles["input"]}
          value={difftool}
          placeholder="e.g. meld"
          onChange={(e) => setDifftool(e.target.value)}
        />
      </label>
      <strong>Updates</strong>
      <label className={styles["check"]}>
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        <span>Check for updates automatically</span>
      </label>
      <div className={styles["field"]}>
        <button
          type="button"
          disabled={upd.status === "checking" || upd.status === "downloading"}
          onClick={() => void upd.check({ manual: true })}
        >
          Check now
        </button>
        {upd.status === "checking" && <span className={styles["hint"]}>Checking…</span>}
        {upd.status !== "checking" && upd.upToDate && (
          <span className={styles["hint"]}>You&apos;re up to date</span>
        )}
        {upd.status === "available" && (
          <span className={styles["hint"]}>{`GitBranch ${upd.version ?? ""} is available`}</span>
        )}
        {upd.status === "error" && upd.error !== null && (
          <span className={styles["hint"]} role="alert">{`Update check failed: ${upd.error}`}</span>
        )}
      </div>
      <strong>Diagnostics</strong>
      <div className={styles["field"]}>
        <button
          type="button"
          onClick={() =>
            void openLogDir().catch((e: unknown) => reportError(e, "Could not open the log folder"))
          }
        >
          Open log folder
        </button>
        <span className={styles["hint"]}>
          Logs stay on this machine. GitBranch sends no telemetry.
        </span>
      </div>
      {error !== null && (
        <div className={styles["error"]} role="alert">
          {error}
        </div>
      )}
    </FormDialog>
  );
}
