import { memo, type MouseEvent } from "react";
import { formatRelative } from "../../lib/time";
import type { Commit, Ref, Row } from "../../ipc/types";
import { acceptDrag, leaveDrag, takeDrop } from "./dnd";
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
  /** Stable callbacks; GraphView owns the menu. */
  onContextMenu?: (e: MouseEvent, oid: string) => void;
  onRefContextMenu?: (e: MouseEvent, gitRef: Ref) => void;
  /** Stable callbacks for branch drag and drop. */
  onRowDrop?: (source: string, oid: string) => void;
  onRefDrop?: (source: string, target: Ref) => void;
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
  onContextMenu,
  onRefContextMenu,
  onRowDrop,
  onRefDrop,
}: GraphRowProps) {
  const hl = styles["dropTarget"];
  const own = (source: string): boolean =>
    refs.some((r) => r.kind === "localBranch" && r.name === source);
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
      onContextMenu={onContextMenu !== undefined ? (e) => onContextMenu(e, row.oid) : undefined}
      onDragOver={onRowDrop !== undefined ? (e) => acceptDrag(e, hl, own) : undefined}
      onDragLeave={onRowDrop !== undefined ? (e) => leaveDrag(e, hl) : undefined}
      onDrop={
        onRowDrop !== undefined
          ? (e) => {
              const source = takeDrop(e, hl, own);
              if (source !== null) onRowDrop(source, row.oid);
            }
          : undefined
      }
    >
      <LaneStrip row={row} lanes={lanes} isHead={isHead} wipAbove={wipAbove} />
      <span className={styles["subjectCell"]}>
        {refs.map((r) => (
          <RefChip
            key={r.fullName}
            gitRef={r}
            {...(onRefContextMenu !== undefined ? { onContextMenu: onRefContextMenu } : {})}
            {...(onRefDrop !== undefined ? { onBranchDrop: onRefDrop } : {})}
          />
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
