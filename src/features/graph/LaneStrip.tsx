import { memo } from "react";
import type { Row } from "../../ipc/types";
import { AVATAR_R, LANE_W, NODE_R, ROW_H } from "./constants";
import { colorIndex, laneX, lanePaths } from "./lanePaths";
import styles from "./Graph.module.css";

interface Props {
  row: Row;
  /** Total lane columns, so every row strip has the same width. */
  lanes: number;
  isHead: boolean;
  /** The dashed WIP connector ends at this row: draw its top half, dashed. */
  wipAbove?: boolean;
  /** Merge commits draw a small filled dot instead of an avatar. */
  isMerge?: boolean;
  /** Avatar text and palette index (`--avatar-N`). */
  initials?: string;
  avatarIdx?: number;
  /** The row has ref chips: draw the connector from the refs column to the node. */
  hasRefs?: boolean;
}

export const LaneStrip = memo(function LaneStrip({
  row,
  lanes,
  isHead,
  wipAbove = false,
  isMerge = false,
  initials = "?",
  avatarIdx = 0,
  hasRefs = false,
}: Props) {
  const paths = lanePaths(row, row.hasIncoming || (isHead && wipAbove));
  const cx = laneX(row.lane);
  const cy = ROW_H / 2;
  const laneCls = styles[`lane${colorIndex(row.color)}`];
  return (
    <svg
      className={styles["strip"]}
      width={lanes * LANE_W}
      height={ROW_H}
      aria-hidden="true"
      focusable="false"
    >
      {hasRefs && (
        <line
          x1={0}
          y1={cy}
          x2={cx}
          y2={cy}
          className={laneCls}
          stroke="currentColor"
          strokeWidth={1}
        />
      )}
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          className={styles[`lane${colorIndex(p.color)}`]}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeDasharray={wipAbove && p.kind === "incoming" ? "3 3" : undefined}
        />
      ))}
      {isMerge ? (
        <>
          {isHead && (
            <circle
              cx={cx}
              cy={cy}
              r={NODE_R + 3}
              className={laneCls}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            />
          )}
          <circle cx={cx} cy={cy} r={NODE_R} className={laneCls} fill="currentColor" />
        </>
      ) : (
        <g data-node="avatar">
          <circle cx={cx} cy={cy} r={AVATAR_R - 1} className={styles[`avatar${avatarIdx}`]} />
          <circle
            cx={cx}
            cy={cy}
            r={AVATAR_R - 1}
            className={laneCls}
            fill="none"
            stroke="currentColor"
            strokeWidth={isHead ? 3 : 2}
          />
          <text
            x={cx}
            y={cy}
            className={styles["avatarText"]}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {initials}
          </text>
        </g>
      )}
    </svg>
  );
});
