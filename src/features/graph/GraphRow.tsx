import { memo } from "react";
import { formatRelative } from "../../lib/time";
import type { Commit, Ref, Row } from "../../ipc/types";
import { rowDomId } from "./domId";
import { LaneStrip } from "./LaneStrip";
import { RefChip } from "./RefChip";
import styles from "./Graph.module.css";

export interface GraphRowProps {
  row: Row;
  commit: Commit;
  refs: Ref[];
  lanes: number;
  /** Pixel offset from the top of the scroll area (virtualizer). */
  top: number;
  selected: boolean;
  hovered: boolean;
  isHead: boolean;
  wipAbove?: boolean;
  onSelect: (oid: string) => void;
  onHover: (oid: string | null) => void;
}

export const GraphRow = memo(function GraphRow({
  row,
  commit,
  refs,
  lanes,
  top,
  selected,
  hovered,
  isHead,
  wipAbove = false,
  onSelect,
  onHover,
}: GraphRowProps) {
  const cls = [styles["row"], selected ? styles["selected"] : "", hovered ? styles["hovered"] : ""];
  return (
    <div
      id={rowDomId(row.oid)}
      role="option"
      aria-selected={selected}
      className={cls.join(" ")}
      style={{ transform: `translateY(${top}px)` }}
      onClick={() => onSelect(row.oid)}
      onMouseEnter={() => onHover(row.oid)}
      onMouseLeave={() => onHover(null)}
    >
      <LaneStrip row={row} lanes={lanes} isHead={isHead} wipAbove={wipAbove} />
      <span className={styles["subjectCell"]}>
        {refs.map((r) => (
          <RefChip key={r.fullName} gitRef={r} />
        ))}
        <span className={styles["subject"]}>{commit.subject}</span>
      </span>
      <span className={styles["author"]}>{commit.authorName}</span>
      <span className={styles["date"]}>
        {formatRelative(commit.authorTime, Math.floor(Date.now() / 1000))}
      </span>
    </div>
  );
});
