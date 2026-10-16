import { memo } from "react";
import type { Row } from "../../ipc/types";
import { LANE_W, NODE_R, ROW_H } from "./constants";
import { colorIndex, laneX, lanePaths } from "./lanePaths";
import styles from "./Graph.module.css";

interface Props {
  row: Row;
  /** Total lane columns, so every row strip has the same width. */
  lanes: number;
  isHead: boolean;
}

export const LaneStrip = memo(function LaneStrip({ row, lanes, isHead }: Props) {
  const paths = lanePaths(row, row.hasIncoming);
  const cx = laneX(row.lane);
  const nodeCls = styles[`lane${colorIndex(row.color)}`];
  return (
    <svg
      className={styles["strip"]}
      width={lanes * LANE_W}
      height={ROW_H}
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          className={styles[`lane${colorIndex(p.color)}`]}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        />
      ))}
      {isHead && (
        <circle
          cx={cx}
          cy={ROW_H / 2}
          r={NODE_R + 3}
          className={nodeCls}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        />
      )}
      <circle cx={cx} cy={ROW_H / 2} r={NODE_R} className={nodeCls} fill="currentColor" />
    </svg>
  );
});
