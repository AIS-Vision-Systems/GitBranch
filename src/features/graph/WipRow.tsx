import { memo, type MouseEvent } from "react";
import { WIP_OID } from "../../state/graph";
import { COL_GAP, LANE_W, NODE_R, ROW_H } from "./constants";
import { rowDomId } from "./domId";
import { colorIndex, laneX } from "./lanePaths";
import styles from "./Graph.module.css";

interface Props {
  fileCount: number;
  lane: number;
  color: number;
  lanes: number;
  /** Draw the dashed connector only when HEAD is the first real row. */
  connected: boolean;
  top: number;
  selected: boolean;
  hovered: boolean;
  onSelect: (oid: string) => void;
  onHover: (oid: string | null) => void;
  /** Stable callback; GraphView owns the menu. */
  onContextMenu?: (e: MouseEvent) => void;
}

export const WipRow = memo(function WipRow({
  fileCount,
  lane,
  color,
  lanes,
  connected,
  top,
  selected,
  hovered,
  onSelect,
  onHover,
  onContextMenu,
}: Props) {
  const x = laneX(lane);
  const laneCls = styles[`lane${colorIndex(color)}`];
  const cls = [styles["row"], selected ? styles["selected"] : "", hovered ? styles["hovered"] : ""];
  return (
    <div
      id={rowDomId(WIP_OID)}
      role="option"
      aria-selected={selected}
      className={cls.join(" ")}
      style={{ transform: `translateY(${top}px)` }}
      onClick={() => onSelect(WIP_OID)}
      onMouseEnter={() => onHover(WIP_OID)}
      onMouseLeave={() => onHover(null)}
      onContextMenu={onContextMenu}
    >
      <span className={styles["refsCell"]} />
      <svg
        className={styles["strip"]}
        width={lanes * LANE_W + 2 * COL_GAP}
        height={ROW_H}
        aria-hidden="true"
        focusable="false"
      >
        {/* Same spill into the column gaps as LaneStrip, so the node stays on its lane. */}
        <g transform={`translate(${COL_GAP} 0)`}>
          {connected && (
            <path
              d={`M ${x} ${ROW_H / 2} L ${x} ${ROW_H}`}
              className={laneCls}
              stroke="currentColor"
              strokeWidth={2.5}
              strokeDasharray="3 3"
              fill="none"
            />
          )}
          <circle
            cx={x}
            cy={ROW_H / 2}
            r={NODE_R}
            className={laneCls}
            stroke="currentColor"
            strokeWidth={2}
            fill="none"
          />
        </g>
      </svg>
      <span className={styles["messageCell"]}>
        <span className={`${styles["bar"]} ${laneCls}`} />
        <span className={`${styles["subject"]} ${styles["wipText"]}`}>
          {`Working tree changes (${fileCount} ${fileCount === 1 ? "file" : "files"})`}
        </span>
      </span>
      <span className={styles["author"]} />
      <span className={styles["date"]} />
    </div>
  );
});
