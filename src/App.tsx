import { useEffect, useState } from "react";
import { appInfo } from "./ipc/app";
import type { AppInfo } from "./ipc/types";
import { Toasts } from "./features/shell/Toasts";
import { reportError, useUiStore, type Theme } from "./state/ui";
import styles from "./App.module.css";

const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

export default function App() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
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

  return (
    <div className={styles["app"]}>
      <header className={styles["header"]}>
        <span className={styles["name"]}>GitBranch</span>
        <button
          type="button"
          className={styles["themeButton"]}
          onClick={() => setTheme(NEXT_THEME[theme])}
        >
          Theme: {theme}
        </button>
      </header>
      <main className={styles["body"]}>
        {info !== null && `GitBranch v${info.version} · git-core ${info.gitCoreVersion}`}
      </main>
      <Toasts />
    </div>
  );
}
