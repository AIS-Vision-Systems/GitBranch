import { create } from "zustand";
import * as ipc from "../ipc/commit";
import type { CommitDetails, DiffTarget, FileDiff } from "../ipc/commit";
import type { RepoId } from "../ipc/types";
import { reportError } from "./ui";

export type DiffViewMode = "unified" | "split";
export const VIEW_KEY = "gitbranch.diffView";

export interface SelectedFile {
  target: DiffTarget;
  label: string;
}

interface DetailsState {
  details: CommitDetails | null;
  loadingDetails: boolean;
  selectedFile: SelectedFile | null;
  diff: FileDiff | null;
  loadingDiff: boolean;
  view: DiffViewMode;
  loadDetails: (repoId: RepoId, oid: string) => Promise<void>;
  selectFile: (repoId: RepoId, target: DiffTarget, label: string) => Promise<void>;
  setView: (v: DiffViewMode) => void;
  clear: () => void;
}

function readView(): DiffViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

let detailsGen = 0;
let diffGen = 0;

export const useDetailsStore = create<DetailsState>((set, get) => ({
  details: null,
  loadingDetails: false,
  selectedFile: null,
  diff: null,
  loadingDiff: false,
  view: readView(),

  loadDetails: async (repoId, oid) => {
    const gen = ++detailsGen;
    ++diffGen;
    set({
      details: null,
      loadingDetails: true,
      selectedFile: null,
      diff: null,
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
    const gen = ++diffGen;
    set({ selectedFile: { target, label }, diff: null, loadingDiff: true });
    try {
      const diff = await ipc.fileDiff(repoId, target);
      if (gen !== diffGen) return;
      set({ diff, loadingDiff: false });
    } catch (e) {
      if (gen !== diffGen) return;
      set({ loadingDiff: false });
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

  clear: () => {
    ++detailsGen;
    ++diffGen;
    set({
      details: null,
      loadingDetails: false,
      selectedFile: null,
      diff: null,
      loadingDiff: false,
    });
  },
}));
