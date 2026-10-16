import { memo, useMemo, type MouseEvent } from "react";
import { formatRelative } from "../../lib/time";
import type { Commit, Ref, Row } from "../../ipc/types";
import { avatarColor, initials } from "./avatar";
import { chipItems } from "./chips";
import { MAX_CHIPS } from "./constants";
import { colorIndex } from "./lanePaths";
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
  /** All of this row's chips are shown (the `+N` pill was clicked). */
  expanded?: boolean;
  /** Stable callback: expand this row's chips. */
  onExpand?: (oid: string) => void;
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
  expanded = false,
  onExpand,
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
  const cls = [
    styles["row"],
    selected ? styles["selected"] : "",
    hovered ? styles["hovered"] : "",
    expanded ? styles["expandedRow"] : "",
  ];
  const isMerge = commit.parents.length > 1;
  const items = useMemo(() => chipItems(refs), [refs]);
  const shown = expanded ? items : items.slice(0, MAX_CHIPS);
  const hidden = items.length - shown.length;
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
      <span className={styles["refsCell"]}>
        {shown.length > 0 && (
          <span
            className={expanded ? styles["refsOverlay"] : styles["refsInline"]}
            data-refs-overlay={expanded ? "" : undefined}
          >
            {shown.map((it) => (
              <RefChip
                key={it.gitRef.fullName}
                gitRef={it.gitRef}
                withUpstream={it.withUpstream}
                {...(onRefContextMenu !== undefined ? { onContextMenu: onRefContextMenu } : {})}
                {...(onRefDrop !== undefined ? { onBranchDrop: onRefDrop } : {})}
              />
            ))}
            {hidden > 0 && (
              <button
                type="button"
                className={styles["morePill"]}
                title={`${hidden} more refs`}
                onClick={(e) => {
                  e.stopPropagation();
                  onExpand?.(row.oid);
                }}
              >
                +{hidden}
              </button>
            )}
          </span>
        )}
      </span>
      <LaneStrip
        row={row}
        lanes={lanes}
        isHead={isHead}
        wipAbove={wipAbove}
        isMerge={isMerge}
        initials={initials(commit.authorName)}
        avatarIdx={avatarColor(commit.authorEmail)}
        hasRefs={items.length > 0}
      />
      <span className={styles["messageCell"]}>
        <span className={`${styles["bar"]} ${styles[`lane${colorIndex(row.color)}`]}`} />
        <span
          className={isMerge ? `${styles["subject"]} ${styles["mergeSubject"]}` : styles["subject"]}
        >
          {commit.subject}
        </span>
      </span>
      <span className={styles["author"]}>{commit.authorName}</span>
      <span className={styles["date"]}>
        {formatRelative(commit.authorTime, Math.floor(Date.now() / 1000))}
      </span>
    </div>
  );
});
