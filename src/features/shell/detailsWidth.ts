import { useCallback, useEffect, useState } from "react";

export const STORAGE_KEY = "gitbranch.detailsWidth";
export const DEFAULT_WIDTH = 480;
export const MIN_WIDTH = 320;
export const MAX_FRACTION = 0.7;

export function maxWidth(): number {
  return Math.max(MIN_WIDTH, Math.floor(window.innerWidth * MAX_FRACTION));
}

export function clampWidth(w: number): number {
  return Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(w)));
}

function readStored(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? clampWidth(n) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function persist(w: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(w));
  } catch {
    // Storage unavailable: the width just won't persist.
  }
}

/** Width state for the details pane, persisted in localStorage. */
export function useDetailsWidth(): [number, (w: number) => void] {
  const [width, setWidth] = useState<number>(readStored);
  const update = useCallback((w: number) => {
    const c = clampWidth(w);
    setWidth(c);
    persist(c);
  }, []);
  useEffect(() => {
    const onResize = (): void => setWidth((w) => clampWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return [width, update];
}
