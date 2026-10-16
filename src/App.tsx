import { useEffect, useState } from "react";
import { appInfo } from "./ipc/app";
import type { AppInfo } from "./ipc/types";
import { WorktreeChoice } from "./features/dialogs/WorktreeChoice/WorktreeChoice";
import { Toasts } from "./features/shell/Toasts";
import { Welcome } from "./features/welcome/Welcome";
import { useReposStore } from "./state/repos";
import { reportError, useUiStore, type Theme } from "./state/ui";
import styles from "./App.module.css";

const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

export default function App() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const current = useReposStore((s) => s.open.find((r) => r.repoId === s.currentId) ?? null);
  const loadRecent = useReposStore((s) => s.loadRecent);
  const openViaDialog = useReposStore((s) => s.openViaDialog);
  const close = useReposStore((s) => s.close);
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    appInfo().then(
      (i) => {
        if (!cancelled) setInfo(i);
      },
      (e: unknown) => reportError(e, "Failed to load app info"),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void openViaDialog();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openViaDialog]);

  return (
    <div className={styles["app"]}>
      <header className={styles["header"]}>
        <span className={styles["name"]}>{current !== null ? current.name : "GitBranch"}</span>
        {current !== null && (
          <button
            type="button"
            className={styles["themeButton"]}
            onClick={() => void close(current.repoId)}
          >
            Close
          </button>
        )}
        <button
          type="button"
          className={styles["themeButton"]}
          onClick={() => setTheme(NEXT_THEME[theme])}
        >
          Theme: {theme}
        </button>
      </header>
      <main className={styles["body"]}>
        {current !== null ? (
          <p>Graph goes here</p>
        ) : (
          <>
            <Welcome />
            {info !== null && (
              <p>{`GitBranch v${info.version} · git-core ${info.gitCoreVersion}`}</p>
            )}
          </>
        )}
      </main>
      <WorktreeChoice />
      <Toasts />
    </div>
  );
}
