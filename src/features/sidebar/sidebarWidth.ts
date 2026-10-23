import { createWidthStore } from "../shell/paneWidth";

export const SIDEBAR_WIDTH_KEY = "gitbranch.sidebarWidth";

export const sidebarWidth = createWidthStore({
  key: SIDEBAR_WIDTH_KEY,
  defaultWidth: 260,
  min: 180,
  maxFraction: 0.45,
});

/** Width state for the sidebar, persisted in localStorage. */
export const useSidebarWidth = sidebarWidth.useWidth;
