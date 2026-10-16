import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import styles from "./ContextMenu.module.css";

export type MenuItem =
  | {
      kind: "item";
      id: string;
      label: string;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { kind: "separator" };

export interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

const MARGIN = 4;

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x + width > vw - MARGIN ? x - width : x;
    let top = y + height > vh - MARGIN ? y - height : y;
    left = Math.max(MARGIN, Math.min(left, vw - width - MARGIN));
    top = Math.max(MARGIN, Math.min(top, vh - height - MARGIN));
    setPos({ left, top });
  }, [x, y, items]);

  const enabledButtons = (): HTMLButtonElement[] =>
    Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []).filter(
      (b) => !b.disabled,
    );

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    enabledButtons()[0]?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    const close = (): void => onCloseRef.current();
    const onDown = (e: MouseEvent): void => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) close();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent): void => {
    const buttons = enabledButtons();
    const idx = buttons.findIndex((b) => b === document.activeElement);
    const focusAt = (i: number): void => buttons[(i + buttons.length) % buttons.length]?.focus();
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusAt(idx + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusAt(idx < 0 ? -1 : idx - 1);
        break;
      case "Home":
        e.preventDefault();
        focusAt(0);
        break;
      case "End":
        e.preventDefault();
        focusAt(-1);
        break;
      case "Escape":
      case "Tab":
        e.preventDefault();
        onClose();
        break;
    }
  };

  return (
    <div
      ref={ref}
      className={styles["menu"]}
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.kind === "separator" ? (
          <div key={`sep-${i}`} role="separator" className={styles["separator"]} />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`${styles["item"]} ${item.danger === true ? styles["danger"] : ""}`}
            disabled={item.disabled === true}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut !== undefined && (
              <span className={styles["shortcut"]}>{item.shortcut}</span>
            )}
          </button>
        ),
      )}
    </div>
  );
}
