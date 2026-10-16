import { useEffect, useState } from "react";
import { appInfo } from "./ipc/app";
import type { AppInfo } from "./ipc/types";
import { registerPhase2Dialogs } from "./features/dialogs";
import { OpBanner } from "./features/shell/OpBanner";
import { Toolbar } from "./features/shell/Toolbar";
import { WorktreeChoice } from "./features/dialogs/WorktreeChoice/WorktreeChoice";
import { GraphView } from "./features/graph/GraphView";
import { DetailsPane } from "./features/commit/DetailsPane";
import { onRepoChanged } from "./ipc/events";
import { onOpProgress } from "./ipc/progress";
import { useProgressStore } from "./state/progress";
import { ProgressBar } from "./features/shell/ProgressBar";
import { useGraphStore } from "./state/graph";
import { useDetailsWidth } from "./features/shell/detailsWidth";
import { Splitter } from "./features/shell/Splitter";
import { DialogHost } from "./features/shell/DialogHost";
import { Toasts } from "./features/shell/Toasts";
import { Welcome } from "./features/welcome/Welcome";
import { useDialogsStore } from "./state/dialogs";
import { useOpsStore } from "./state/ops";
import { openClone } from "./features/dialogs/open";
import { useReposStore } from "./state/repos";
import { reportError, useUiStore, type Theme } from "./state/ui";
import styles from "./App.module.css";

registerPhase2Dialogs();

const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

export default function App() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const current = useReposStore((s) => s.open.find((r) => r.repoId === s.currentId) ?? null);
  const loadRecent = useReposStore((s) => s.loadRecent);
  const openViaDialog = useReposStore((s) => s.openViaDialog);
  const close = useReposStore((s) => s.close);
  const [detailsWidth, setDetailsWidth] = useDetailsWidth();
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    appInfo().then(
      (i) => {
        if (cancelled) return;
        setInfo(i);
        if (i.startupRepo !== null) void useReposStore.getState().openPath(i.startupRepo);
      },
      (e: unknown) => reportError(e, "Failed to load app info"),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    onRepoChanged((e) => {
      void useGraphStore.getState().refresh(e.repoId, e.what);
    }).then(
      (fn) => {
        if (disposed) fn();
        else unlisten = fn;
      },
      (err: unknown) => reportError(err, "Could not subscribe to repository changes"),
    );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    onOpProgress((e) => useProgressStore.getState().update(e)).then(
      (fn) => {
        if (disposed) fn();
        else unlisten = fn;
      },
      (err: unknown) => reportError(err, "Could not subscribe to progress events"),
    );
    return () => {
      disposed = true;
      unlisten?.();
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
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "c" &&
        !e.repeat &&
        useDialogsStore.getState().current === null &&
        !useOpsStore.getState().busy
      ) {
        const t = e.target;
        if (
          t instanceof HTMLInputElement ||
          t instanceof HTMLTextAreaElement ||
          t instanceof HTMLSelectElement ||
          (t instanceof HTMLElement &&
            (t.isContentEditable || t.closest('[aria-modal="true"]') !== null))
        ) {
          return;
        }
        e.preventDefault();
        openClone();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openViaDialog]);

  return (
    <div className={styles["app"]}>
      <header className={styles["header"]}>
        <span className={styles["name"]}>{current !== null ? current.name : "GitBranch"}</span>
        {current !== null && <Toolbar repoId={current.repoId} />}
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
      <ProgressBar />
      {current !== null && <OpBanner repoId={current.repoId} />}
      <main className={current !== null ? styles["bodyGraph"] : styles["body"]}>
        {current !== null ? (
          <div className={styles["panes"]}>
            <div className={styles["graphPane"]}>
              <GraphView key={current.repoId} repoId={current.repoId} />
            </div>
            <Splitter width={detailsWidth} onChange={setDetailsWidth} />
            <aside className={styles["details"]} style={{ width: detailsWidth }}>
              <DetailsPane key={current.repoId} repoId={current.repoId} />
            </aside>
          </div>
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
      <DialogHost />
      <Toasts />
    </div>
  );
}
