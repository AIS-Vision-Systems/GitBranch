import { useCallback, useState } from "react";
import { useTreeExpansionStore, type Expanded } from "../../state/treeExpansion";

export const FILE_TREE_KEY = "gitbranch.fileTree";
const OLD_TREE_KEY = "gitbranch.wipTree";

/** Tree (true) or flat (false) file view, persisted; migrates the pre-5.9 `gitbranch.wipTree` key. */
export function useTreeMode(): [boolean, (v: boolean) => void] {
  const [tree, setTree] = useState<boolean>(() => {
    try {
      let raw = localStorage.getItem(FILE_TREE_KEY);
      if (raw === null) {
        raw = localStorage.getItem(OLD_TREE_KEY);
        if (raw !== null) {
          localStorage.setItem(FILE_TREE_KEY, raw);
          localStorage.removeItem(OLD_TREE_KEY);
        }
      }
      return raw !== "false";
    } catch {
      return true;
    }
  });
  const choose = (v: boolean): void => {
    setTree(v);
    try {
      localStorage.setItem(FILE_TREE_KEY, String(v));
    } catch {
      /* storage unavailable */
    }
  };
  return [tree, choose];
}

export type { Expanded };

/** Expanded-folder state for the tree `key`, remembered for the session; `initial` until first change. */
export function useExpanded(key: string, initial: Expanded): [Expanded, (e: Expanded) => void] {
  const value = useTreeExpansionStore((s) => s.byKey[key]) ?? initial;
  const setStore = useTreeExpansionStore((s) => s.set);
  const setValue = useCallback((e: Expanded) => setStore(key, e), [setStore, key]);
  return [value, setValue];
}
