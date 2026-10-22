import { useEffect, useState } from "react";
import { appInfo, loadSession, takeLaunchPath } from "./ipc/app";
import { drainLaunchPaths } from "./lib/launchPath";
import type { AppInfo } from "./ipc/types";
import { registerPhase2Dialogs } from "./features/dialogs";
import { OpBanner } from "./features/shell/OpBanner";
import { RepoTabs } from "./features/shell/RepoTabs";
import { Toolbar } from "./features/shell/Toolbar";
import { WorktreeChoice } from "./features/dialogs/WorktreeChoice/WorktreeChoice";
import { GraphView } from "./features/graph/GraphView";
import { BlameView } from "./features/blame/BlameView";
import { CenterDiff } from "./features/diff/CenterDiff";
import { useDetailsStore } from "./state/details";
import { DetailsPane } from "./features/commit/DetailsPane";
import { onOpenRepoRequest, onRepoChanged } from "./ipc/events";
import { onOpProgress } from "./ipc/progress";
import { useProgressStore } from "./state/progress";
import { ProgressBar } from "./features/shell/ProgressBar";
import { useGraphStore } from "./state/graph";
import { useDetailsWidth } from "./features/shell/detailsWidth";
import { Splitter } from "./features/shell/Splitter";
import { DialogHost } from "./features/shell/DialogHost";
import { Toasts } from "./features/shell/Toasts";
import { UpdateCard } from "./features/shell/UpdateCard";
import { startUpdateScheduler } from "./state/updater";
import { isEditableTarget } from "./lib/keys";
import { Welcome } from "./features/welcome/Welcome";
import { useDialogsStore } from "./state/dialogs";
import { useOpsStore } from "./state/ops";
import { openAddWorktree, openClone } from "./features/dialogs/open";
import { AccountMenu } from "./features/github/AccountMenu";
import { Sidebar } from "./features/sidebar/Sidebar";
import { CommandPalette } from "./features/shell/CommandPalette";
import { openSettings } from "./features/dialogs/open";
import { useSettingsStore } from "./state/settings";
import { usePaletteStore } from "./state/palette";
import { useReposStore } from "./state/repos";
import { startSessionSync } from "./state/session";
import { reportError, useUiStore } from "./state/ui";
import { CircleHelp, Settings } from "./lib/icons";
import styles from "./App.module.css";

registerPhase2Dialogs();

export default function App() {
  const current = useReposStore((s) => s.open.find((r) => r.repoId === s.currentId) ?? null);
  const hasTabs = useReposStore((s) => s.open.length > 0);
  const loadRecent = useReposStore((s) => s.loadRecent);
  const openViaDialog = useReposStore((s) => s.openViaDialog);
  const close = useReposStore((s) => s.close);
  const [detailsWidth, setDetailsWidth] = useDetailsWidth();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const currentId = current?.repoId ?? null;

  useEffect(() => {
    let cancelled = false;
    let stopSync: (() => void) | null = null;
    let stopOpenRequests: (() => void) | null = null;
    void (async () => {
      try {
        const stop = await onOpenRepoRequest((e) => {
          void useReposStore.getState().openPath(e.path);
        });
        if (cancelled) stop();
        else stopOpenRequests = stop;
      } catch (e) {
        reportError(e, "Could not subscribe to open-repository requests");
      }
      let startup: string | null = null;
      try {
        const i = await appInfo();
        startup = i.startupRepo;
        if (!cancelled) setInfo(i);
      } catch (e) {
        reportError(e, "Failed to load app info");
      }
      try {
        await useReposStore.getState().restoreSession(await loadSession());
      } catch (e) {
        reportError(e, "Could not restore the previous session");
      }
      if (cancelled) return;
      if (cancelled) return;
      stopSync = startSessionSync();
      if (startup !== null) await useReposStore.getState().openPath(startup);
      try {
        await drainLaunchPaths(takeLaunchPath, (p) => useReposStore.getState().openPath(p));
      } catch (e) {
        reportError(e, "Could not open the repository passed on launch");
      }
    })();
    return () => {
      cancelled = true;
      stopSync?.();
      stopOpenRequests?.();
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
    void useSettingsStore.getState().load();
  }, [loadRecent]);

  useEffect(() => startUpdateScheduler(), []);

  const centerView = useUiStore((s) => s.centerView);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        const t = e.target;
        const blocked =
          useDialogsStore.getState().current !== null ||
          isEditableTarget(t) ||
          (t instanceof HTMLElement &&
            (t.closest('[aria-modal="true"]') !== null || t.closest('[role="menu"]') !== null));
        if (!blocked && useUiStore.getState().centerView === "diff") {
          useDetailsStore.getState().clear();
        } else if (!blocked && useUiStore.getState().centerView === "blame") {
          useUiStore.getState().showGraph();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void openViaDialog();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && !e.shiftKey && !e.altKey && e.key === ",") {
        e.preventDefault();
        if (!e.repeat && useDialogsStore.getState().current === null) openSettings();
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && k === "b") {
        e.preventDefault();
        if (!e.repeat && useDialogsStore.getState().current === null) {
          useUiStore.getState().toggleSidebar();
        }
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && k === "k") {
        e.preventDefault();
        if (!e.repeat && useDialogsStore.getState().current === null) {
          usePaletteStore.getState().toggle();
        }
        return;
      }
      if (
        mod &&
        !e.shiftKey &&
        !e.altKey &&
        k === "f" &&
        !isEditableTarget(e.target) &&
        current !== null &&
        useUiStore.getState().centerView === "graph" &&
        useDialogsStore.getState().current === null &&
        !usePaletteStore.getState().open
      ) {
        e.preventDefault();
        useGraphStore.getState().openFilterBar(current.repoId);
        return;
      }
      if (
        mod &&
        !e.shiftKey &&
        !e.altKey &&
        k === "t" &&
        !e.repeat &&
        useDialogsStore.getState().current === null
      ) {
        e.preventDefault();
        useReposStore.getState().newTab();
        return;
      }
      const tabKey =
        mod && !e.shiftKey && !e.altKey && (e.key === "PageDown" || e.key === "PageUp");
      const closeTab = mod && !e.shiftKey && !e.altKey && k === "w" && currentId !== null;
      const shifted =
        mod && e.shiftKey && !e.altKey && (k === "c" || (k === "w" && currentId !== null));
      if (!(tabKey || closeTab || shifted) || e.repeat) return;
      if (useDialogsStore.getState().current !== null) return;
      if (!tabKey && useOpsStore.getState().busy) return;
      const t = e.target;
      if (
        isEditableTarget(t) ||
        (t instanceof HTMLElement && t.closest('[aria-modal="true"]') !== null)
      ) {
        return;
      }
      e.preventDefault();
      if (tabKey) useReposStore.getState().nextTab(e.key === "PageDown" ? 1 : -1);
      else if (closeTab && currentId !== null) void close(currentId);
      else if (k === "w" && currentId !== null) openAddWorktree(currentId);
      else openClone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openViaDialog, close, currentId, current]);

  return (
    <div className={styles["app"]}>
      <header className={styles["header"]}>
        {hasTabs ? <RepoTabs /> : <span className={styles["name"]}>GitBranch</span>}
        <div className={styles["headerActions"]}>
          <button
            type="button"
            className={styles["iconButton"]}
            aria-label="Help"
            title="Help"
            onClick={() => useUiStore.getState().setAboutOpen(true)}
          >
            <CircleHelp size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles["iconButton"]}
            aria-label="Settings"
            title="Settings (Ctrl+,)"
            onClick={() => openSettings()}
          >
            <Settings size={18} aria-hidden="true" />
          </button>
          <AccountMenu />
        </div>
      </header>
      {current !== null && (
        <div className={styles["toolbarRow"]}>
          <Toolbar repoId={current.repoId} />
        </div>
      )}
      <ProgressBar />
      {current !== null && <OpBanner repoId={current.repoId} />}
      <main className={current !== null ? styles["bodyGraph"] : styles["body"]}>
        {current !== null ? (
          <div className={styles["panes"]}>
            {sidebarOpen && <Sidebar key={current.repoId} repoId={current.repoId} />}
            <div className={styles["graphPane"]}>
              {centerView === "diff" ? (
                <CenterDiff key={current.repoId} repoId={current.repoId} />
              ) : centerView === "blame" ? (
                <BlameView key={current.repoId} repoId={current.repoId} />
              ) : (
                <GraphView key={current.repoId} repoId={current.repoId} />
              )}
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
      <CommandPalette />
      <UpdateCard />
      <Toasts />
    </div>
  );
}
