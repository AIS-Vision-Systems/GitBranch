import { create } from "zustand";
import * as ipc from "../ipc/commit";
import type { CommitDetails, DiffTarget, FileDiff } from "../ipc/commit";
import type { RepoId } from "../ipc/types";
import { reportError, useUiStore } from "./ui";

export type DiffViewMode = "unified" | "split";
export const VIEW_KEY = "gitbranch.diffView";
export const WHOLE_FILE_KEY = "gitbranch.diffWholeFile";

export interface SelectedFile {
  target: DiffTarget;
  label: string;
}

interface DetailsState {
  details: CommitDetails | null;
  loadingDetails: boolean;
  selectedFile: SelectedFile | null;
  diff: FileDiff | null;
  /** New-side text of `diff` for the whole-file view; null = hunks only. */
  fullText: string | null;
  loadingDiff: boolean;
  view: DiffViewMode;
  /** Show unchanged lines between and around hunks (default on). */
  wholeFile: boolean;
  loadDetails: (repoId: RepoId, oid: string) => Promise<void>;
  selectFile: (repoId: RepoId, target: DiffTarget, label: string) => Promise<void>;
  /** Like selectFile but never toggles: (re)loads the diff of this file. */
  reloadFile: (repoId: RepoId, target: DiffTarget, label: string) => Promise<void>;
  setView: (v: DiffViewMode) => void;
  setWholeFile: (v: boolean) => void;
  clear: () => void;
}

function readView(): DiffViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

function readWholeFile(): boolean {
  try {
    return localStorage.getItem(WHOLE_FILE_KEY) !== "false";
  } catch {
    return true;
  }
}

/** The whole-file text is only useful for a text diff with hunks and an existing new side. */
async function loadFullText(
  repoId: RepoId,
  target: DiffTarget,
  diff: FileDiff,
): Promise<string | null> {
  if (
    diff.binary ||
    diff.tooLarge === true ||
    diff.combined === true ||
    diff.hunks.length === 0 ||
    diff.newPath === null ||
    target.kind === "untracked"
  ) {
    return null;
  }
  try {
    return (await ipc.fileNewText(repoId, target)) ?? null;
  } catch {
    return null;
  }
}

/** DiffTarget is a flat object; compare it field by field. */
export function sameTarget(a: DiffTarget, b: DiffTarget): boolean {
  const ka = Object.keys(a) as (keyof DiffTarget)[];
  return (
    ka.length === Object.keys(b).length &&
    ka.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k])
  );
}

let detailsGen = 0;
let diffGen = 0;

export const useDetailsStore = create<DetailsState>((set, get) => ({
  details: null,
  loadingDetails: false,
  selectedFile: null,
  diff: null,
  fullText: null,
  loadingDiff: false,
  view: readView(),
  wholeFile: readWholeFile(),

  loadDetails: async (repoId, oid) => {
    const gen = ++detailsGen;
    ++diffGen;
    // Selecting a commit from the blame view keeps the blame open.
    if (useUiStore.getState().centerView !== "blame") useUiStore.getState().showGraph();
    set({
      details: null,
      loadingDetails: true,
      selectedFile: null,
      diff: null,
      fullText: null,
      loadingDiff: false,
    });
    try {
      const details = await ipc.commitDetails(repoId, oid);
      if (gen !== detailsGen) return;
      set({ details, loadingDetails: false });
    } catch (e) {
      if (gen !== detailsGen) return;
      set({ loadingDetails: false });
      reportError(e, "Could not load commit details");
    }
  },

  selectFile: async (repoId, target, label) => {
    const cur = get().selectedFile;
    if (cur !== null && sameTarget(cur.target, target)) {
      // Clicking the open file again closes the diff (commit details stay).
      ++diffGen;
      set({ selectedFile: null, diff: null, fullText: null, loadingDiff: false });
      useUiStore.getState().showGraph();
      return;
    }
    await get().reloadFile(repoId, target, label);
  },

  reloadFile: async (repoId, target, label) => {
    useUiStore.getState().showDiff();
    const gen = ++diffGen;
    // Re-fetching the open file (after a stage, a live refresh) keeps the current diff on screen
    // so the scroll position survives; a different file starts from scratch.
    const cur = get().selectedFile;
    if (cur !== null && sameTarget(cur.target, target) && get().diff !== null) {
      set({ selectedFile: { target, label } });
    } else {
      set({ selectedFile: { target, label }, diff: null, fullText: null, loadingDiff: true });
    }
    try {
      const diff = await ipc.fileDiff(repoId, target);
      if (gen !== diffGen) return;
      const fullText = await loadFullText(repoId, target, diff);
      if (gen !== diffGen) return;
      set({ diff, fullText, loadingDiff: false });
    } catch (e) {
      if (gen !== diffGen) return;
      set({ diff: null, fullText: null, loadingDiff: false });
      reportError(e, "Could not load diff");
    }
  },

  setView: (v) => {
    if (get().view !== v) set({ view: v });
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* storage unavailable */
    }
  },

  setWholeFile: (v) => {
    if (get().wholeFile !== v) set({ wholeFile: v });
    try {
      localStorage.setItem(WHOLE_FILE_KEY, String(v));
    } catch {
      /* storage unavailable */
    }
  },

  clear: () => {
    useUiStore.getState().showGraph();
    ++detailsGen;
    ++diffGen;
    set({
      details: null,
      loadingDetails: false,
      selectedFile: null,
      diff: null,
      fullText: null,
      loadingDiff: false,
    });
  },
}));
