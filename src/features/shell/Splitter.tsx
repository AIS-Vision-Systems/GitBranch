import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { DEFAULT_WIDTH, MIN_WIDTH, maxWidth } from "./detailsWidth";
import styles from "./Splitter.module.css";

const STEP = 16;

interface Props {
  /** Current width of the pane to the right of the handle. */
  width: number;
  onChange: (w: number) => void;
}

export function Splitter({ width, onChange }: Props) {
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    onChange(window.innerWidth - e.clientX);
  };
  const end = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "ArrowLeft") onChange(width + STEP);
    else if (e.key === "ArrowRight") onChange(width - STEP);
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize details pane"
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={maxWidth()}
      tabIndex={0}
      className={dragging ? `${styles["splitter"]} ${styles["active"]}` : styles["splitter"]}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onChange(DEFAULT_WIDTH)}
      onKeyDown={onKeyDown}
    />
  );
}
