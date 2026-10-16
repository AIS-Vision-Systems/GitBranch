import { useCallback, useState, type MouseEvent } from "react";

export interface MenuState<T> {
  x: number;
  y: number;
  data: T;
}

export function useContextMenu<T>(): {
  menu: MenuState<T> | null;
  open: (e: MouseEvent, data: T) => void;
  close: () => void;
} {
  const [menu, setMenu] = useState<MenuState<T> | null>(null);
  const open = useCallback((e: MouseEvent, data: T): void => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, data });
  }, []);
  const close = useCallback((): void => setMenu(null), []);
  return { menu, open, close };
}
