import { create } from "zustand";
import { isIpcError } from "../ipc/core";
import * as ipc from "../ipc/stage";
import type { HunkSelection, PatchOp } from "../ipc/stage";
import type { RepoId } from "../ipc/types";
import type { FileListItem } from "../features/commit/FileList";
import { quotePaths } from "../lib/shellQuote";
import { useDetailsStore } from "./details";
import { confirm } from "./dialogs";
import { reportError, useUiStore } from "./ui";

interface WipState {
  busy: boolean;
  stage: (repoId: RepoId, paths: string[]) => Promise<void>;
  unstage: (repoId: RepoId, paths: string[]) => Promise<void>;
  discard: (repoId: RepoId, items: FileListItem[]) => Promise<boolean>;
  stageAll: (repoId: RepoId) => Promise<void>;
  unstageAll: (repoId: RepoId) => Promise<void>;
  /** Resolves true when the patch applied. */
  applyHunk: (repoId: RepoId, sel: HunkSelection, op: PatchOp) => Promise<boolean>;
}

export const useWipStore = create<WipState>((set, get) => {
  async function run(fn: () => Promise<void>, title: string): Promise<boolean> {
    if (get().busy) return false;
    set({ busy: true });
    try {
      await fn();
      return true;
    } catch (e) {
      reportError(e, title);
      return false;
    } finally {
      set({ busy: false });
    }
  }

  return {
    busy: false,

    stage: async (repoId, paths) => {
      await run(() => ipc.stageFiles(repoId, paths), "Could not stage files");
    },

    unstage: async (repoId, paths) => {
      await run(() => ipc.unstageFiles(repoId, paths), "Could not unstage files");
    },

    discard: async (repoId, items) => {
      const tracked = items.filter((i) => i.target.kind !== "untracked").map((i) => i.path);
      const untracked = items.filter((i) => i.target.kind === "untracked").map((i) => i.path);
      if (tracked.length + untracked.length === 0) return false;
      const commands: string[] = [];
      if (tracked.length > 0) commands.push(`git restore --worktree -- ${quotePaths(tracked)}`);
      if (untracked.length > 0) commands.push(`git clean -f -d -- ${quotePaths(untracked)}`);
      const count = tracked.length + untracked.length;
      return confirm({
        title: "Discard changes",
        message: `Discard changes in ${count} ${count === 1 ? "file" : "files"}? This cannot be undone.`,
        command: commands.join("\n"),
        confirmLabel: "Discard",
        danger: true,
        onConfirm: async () => {
          set({ busy: true });
          try {
            await ipc.discardFiles(repoId, tracked, untracked);
          } finally {
            set({ busy: false });
          }
        },
      });
    },

    stageAll: async (repoId) => {
      await run(() => ipc.stageAll(repoId), "Could not stage all");
    },

    unstageAll: async (repoId) => {
      await run(() => ipc.unstageAll(repoId), "Could not unstage all");
    },

    applyHunk: async (repoId, sel, op) => {
      if (get().busy) return false;
      set({ busy: true });
      try {
        await ipc.applyHunk(repoId, sel, op);
        return true;
      } catch (e) {
        if (isIpcError(e) && e.error.code === "stage.stale") {
          useUiStore.getState().pushToast({ kind: "info", title: "File changed, diff reloaded" });
          const f = useDetailsStore.getState().selectedFile;
          if (f !== null) void useDetailsStore.getState().reloadFile(repoId, f.target, f.label);
        } else {
          reportError(e, "Could not apply change");
        }
        return false;
      } finally {
        set({ busy: false });
      }
    },
  };
});
