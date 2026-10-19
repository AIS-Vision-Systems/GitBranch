import { useCallback, useState } from "react";

export const SIDEBAR_KEY = "gitbranch.sidebar";

function read(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "closed";
  } catch {
    return true;
  }
}

export function useSidebarOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(read);
  const toggle = useCallback(() => {
    setOpen((o) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, o ? "closed" : "open");
      } catch {
        // Storage unavailable: the choice just won't persist.
      }
      return !o;
    });
  }, []);
  return [open, toggle];
}
