import { useCallback, useEffect, useState } from "react";

export interface WidthStoreOptions {
  key: string;
  defaultWidth: number;
  min: number;
  /** Maximum width as a fraction of the window width. */
  maxFraction: number;
}

export interface WidthStore {
  useWidth: () => [number, (w: number) => void];
  clamp: (w: number) => number;
  maxWidth: () => number;
  DEFAULT: number;
  MIN: number;
}

/** Builds a localStorage-persisted, window-clamped width hook for a resizable pane. */
export function createWidthStore(opts: WidthStoreOptions): WidthStore {
  const { key, defaultWidth, min, maxFraction } = opts;
  const maxWidth = (): number => Math.max(min, Math.floor(window.innerWidth * maxFraction));
  const clamp = (w: number): number => Math.min(maxWidth(), Math.max(min, Math.round(w)));

  const readStored = (): number => {
    try {
      const raw = localStorage.getItem(key);
      const n = raw === null ? NaN : Number(raw);
      return Number.isFinite(n) ? clamp(n) : defaultWidth;
    } catch {
      return defaultWidth;
    }
  };
  const persist = (w: number): void => {
    try {
      localStorage.setItem(key, String(w));
    } catch {
      // Storage unavailable: the width just won't persist.
    }
  };

  const useWidth = (): [number, (w: number) => void] => {
    const [width, setWidth] = useState<number>(readStored);
    const update = useCallback((w: number) => {
      const c = clamp(w);
      setWidth(c);
      persist(c);
    }, []);
    useEffect(() => {
      const onResize = (): void => setWidth((w) => clamp(w));
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }, []);
    return [width, update];
  };

  return { useWidth, clamp, maxWidth, DEFAULT: defaultWidth, MIN: min };
}
