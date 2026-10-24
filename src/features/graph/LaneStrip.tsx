import { memo, useId } from "react";
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
  /** Inline chips on this row: draw the connector from the refs column to the node. */
  connector?: boolean;
  /** Author photo (data URL); replaces the initials inside the ring. */
  avatarUrl?: string | null;
}

export const LaneStrip = memo(function LaneStrip({
  row,
  lanes,
  isHead,
  wipAbove = false,
  isMerge = false,
  initials = "?",
  avatarIdx = 0,
  connector = false,
  avatarUrl = null,
}: Props) {
  const clipId = `avclip-${useId().replace(/:/g, "")}`;
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
      {connector && (
        <line
          data-connector=""
          x1={0}
          y1={cy}
          x2={isMerge ? cx - NODE_R : cx - (AVATAR_R - 1)}
          y2={cy}
          className={laneCls}
          stroke="currentColor"
          strokeWidth={2}
        />
      )}
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          className={styles[`lane${colorIndex(p.color)}`]}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
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
          {avatarUrl !== null && (
            <>
              <clipPath id={clipId}>
                <circle cx={cx} cy={cy} r={AVATAR_R - 1} />
              </clipPath>
              <image
                href={avatarUrl}
                x={cx - (AVATAR_R - 1)}
                y={cy - (AVATAR_R - 1)}
                width={(AVATAR_R - 1) * 2}
                height={(AVATAR_R - 1) * 2}
                preserveAspectRatio="xMidYMid slice"
                clipPath={`url(#${clipId})`}
              />
            </>
          )}
          <circle
            cx={cx}
            cy={cy}
            r={AVATAR_R - 1}
            className={laneCls}
            fill="none"
            stroke="currentColor"
            strokeWidth={isHead ? 3 : 2}
          />
          {avatarUrl === null && (
            <text
              x={cx}
              y={cy}
              className={styles["avatarText"]}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {initials}
            </text>
          )}
        </g>
      )}
    </svg>
  );
});
