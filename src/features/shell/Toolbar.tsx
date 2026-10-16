import { useEffect, useRef, useState } from "react";
import type { RepoId } from "../../ipc/types";
import { useDialogsStore } from "../../state/dialogs";
import { useGraphStore } from "../../state/graph";
import { undoCommand, useOpsStore } from "../../state/ops";
import { remotesOf, useRemotesStore } from "../../state/remotes";
import {
  openClone,
  openCreateBranch,
  openPull,
  openPush,
  openRemotes,
  openStashPush,
} from "../dialogs/open";
import { StashList } from "../stash/StashList";
import styles from "./Toolbar.module.css";

interface Props {
  repoId: RepoId;
}

const FETCH_ALL = { remote: null, prune: true, tags: false };

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function Toolbar({ repoId }: Props) {
  const clean = useGraphStore((s) => (s.byRepo[repoId]?.status?.entries.length ?? 0) === 0);
  const stashCount = useGraphStore((s) => s.byRepo[repoId]?.stashes.length ?? 0);
  const headOid = useGraphStore((s) => s.byRepo[repoId]?.refs?.head.oid ?? null);
  const undo = useGraphStore((s) => s.byRepo[repoId]?.undo ?? null);
  const inProgress = useGraphStore((s) => s.byRepo[repoId]?.inProgress ?? null) !== null;
  const busy = useOpsStore((s) => s.busy);
  const fetchAll = useOpsStore((s) => s.fetch);
  const hasRemotes = useRemotesStore((s) => remotesOf(s, repoId).length > 0);
  const ahead = useGraphStore(
    (s) =>
      s.byRepo[repoId]?.refs?.refs.find((r) => r.kind === "localBranch" && r.isHead)?.upstream
        ?.ahead ?? 0,
  );
  const undoLast = useOpsStore((s) => s.undoLast);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (undo === null || inProgress) return;
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z")
        return;
      if (e.repeat || useDialogsStore.getState().current !== null) return;
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
      if (!useOpsStore.getState().busy) void undoLast(repoId, undo);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, inProgress, repoId, undoLast]);

  useEffect(() => {
    if (!hasRemotes) return;
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "f" && key !== "l" && key !== "p") return;
      if (e.repeat || useDialogsStore.getState().current !== null) return;
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
      if (useOpsStore.getState().busy) return;
      if (key === "l" && useGraphStore.getState().byRepo[repoId]?.inProgress) return;
      if (key === "f") void fetchAll(repoId, FETCH_ALL);
      else if (key === "l") openPull(repoId);
      else openPush(repoId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasRemotes, repoId, fetchAll]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!(e.target instanceof Node) || !wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles["toolbar"]} role="toolbar" aria-label="Repository actions">
      <button
        type="button"
        className={styles["button"]}
        disabled={undo === null || busy || inProgress}
        title={
          undo === null
            ? "Nothing to undo"
            : inProgress
              ? "Finish or abort the current operation first"
              : `${undo.label}
${undoCommand(undo)}
(Ctrl+Z)`
        }
        onClick={() => undo !== null && void undoLast(repoId, undo)}
      >
        {undo === null ? "Undo" : `Undo: ${truncate(undo.label, 40)}`}
      </button>
      <button
        type="button"
        className={styles["button"]}
        disabled={headOid === null}
        onClick={() => headOid !== null && openCreateBranch(repoId, headOid, "HEAD")}
      >
        Branch…
      </button>
      <button
        type="button"
        className={styles["button"]}
        disabled={clean}
        onClick={() => openStashPush(repoId)}
      >
        Stash
      </button>
      <button
        type="button"
        className={styles["button"]}
        disabled={busy || !hasRemotes}
        title={hasRemotes ? "Fetch all remotes (Ctrl+Shift+F)" : "No remotes configured"}
        onClick={() => void fetchAll(repoId, FETCH_ALL)}
      >
        Fetch
      </button>
      <button
        type="button"
        className={styles["button"]}
        disabled={busy || inProgress || !hasRemotes}
        title={hasRemotes ? "Pull (Ctrl+Shift+L)" : "No remotes configured"}
        onClick={() => openPull(repoId)}
      >
        Pull…
      </button>
      <button
        type="button"
        className={styles["button"]}
        disabled={busy || !hasRemotes}
        title={hasRemotes ? "Push (Ctrl+Shift+P)" : "No remotes configured"}
        onClick={() => openPush(repoId)}
      >
        {ahead > 0 ? `Push… ↑${ahead}` : "Push…"}
      </button>
      <button
        type="button"
        className={styles["button"]}
        title="Clone a repository (Ctrl+Shift+C)"
        onClick={openClone}
      >
        Clone…
      </button>
      <button type="button" className={styles["button"]} onClick={() => openRemotes(repoId)}>
        Remotes…
      </button>
      <div ref={wrapRef} className={styles["popoverHost"]}>
        <button
          type="button"
          className={styles["button"]}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {`Stashes (${stashCount})`}
        </button>
        {open && (
          <div className={styles["popover"]}>
            <StashList repoId={repoId} onShown={() => setOpen(false)} />
          </div>
        )}
      </div>
    </div>
  );
}
