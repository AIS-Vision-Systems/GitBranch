import { useEffect, useRef, type ReactNode } from "react";
import styles from "./Popover.module.css";

interface Props {
  /** Anchor point (viewport coordinates), usually the bottom edge of the trigger button. */
  x: number;
  y: number;
  /** `right` makes `x` the popover's right edge. */
  align?: "left" | "right";
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/** A small anchored popover: closes on Esc / outside press, and returns focus to the trigger. */
export function Popover({ x, y, align = "left", label, onClose, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = ref.current?.querySelector<HTMLElement>("input, button");
    (first ?? ref.current)?.focus();
    const onDown = (e: MouseEvent): void => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);

  return (
    <div
      ref={ref}
      className={styles["popover"]}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      style={align === "left" ? { left: x, top: y } : { right: window.innerWidth - x, top: y }}
    >
      {children}
    </div>
  );
}
