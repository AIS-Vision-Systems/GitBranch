import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { DEFAULT_WIDTH, MIN_WIDTH, maxWidth } from "./detailsWidth";
import styles from "./Splitter.module.css";

const STEP = 16;

interface Props {
  /** Current width of the pane the handle resizes. */
  width: number;
  onChange: (w: number) => void;
  /** Which side of the handle the resized pane is on (default "right"). */
  side?: "left" | "right";
  label?: string;
  min?: number;
  max?: number;
  defaultWidth?: number;
}

export function Splitter({
  width,
  onChange,
  side = "right",
  label = "Resize details pane",
  min = MIN_WIDTH,
  max,
  defaultWidth = DEFAULT_WIDTH,
}: Props) {
  const left = side === "left";
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    if (left) {
      const origin = e.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
      onChange(e.clientX - origin);
    } else {
      onChange(window.innerWidth - e.clientX);
    }
  };
  const end = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const grow = left ? "ArrowRight" : "ArrowLeft";
    const shrink = left ? "ArrowLeft" : "ArrowRight";
    if (e.key === grow) onChange(width + STEP);
    else if (e.key === shrink) onChange(width - STEP);
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max ?? maxWidth()}
      tabIndex={0}
      className={dragging ? `${styles["splitter"]} ${styles["active"]}` : styles["splitter"]}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onChange(defaultWidth)}
      onKeyDown={onKeyDown}
    />
  );
}
