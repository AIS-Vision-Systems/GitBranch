import { createWidthStore } from "./paneWidth";

export const STORAGE_KEY = "gitbranch.detailsWidth";
export const DEFAULT_WIDTH = 480;
export const MIN_WIDTH = 320;
export const MAX_FRACTION = 0.7;

const store = createWidthStore({
  key: STORAGE_KEY,
  defaultWidth: DEFAULT_WIDTH,
  min: MIN_WIDTH,
  maxFraction: MAX_FRACTION,
});

export const maxWidth = store.maxWidth;
export const clampWidth = store.clamp;

/** Width state for the details pane, persisted in localStorage. */
export const useDetailsWidth = store.useWidth;
