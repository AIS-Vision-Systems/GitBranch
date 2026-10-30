import { Fragment, memo, useMemo, type MouseEvent } from "react";
import { formatRelative } from "../../lib/time";
import type { Commit, Ref, RepoId, Row } from "../../ipc/types";
import { useAuthorAvatar } from "../github/useAuthorAvatar";
import { avatarColor, initials } from "./avatar";
import { chipItems } from "./chips";
import { MAX_CHIPS } from "./constants";
import { colorIndex } from "./lanePaths";
import { acceptDrag, leaveDrag, takeDrop } from "./dnd";
import { rowDomId } from "./domId";
import { LaneStrip } from "./LaneStrip";
import { remoteTrackingName } from "./menus";
import { PrBadge } from "./PrBadge";
import { RefChip } from "./RefChip";
import { WorktreeChip } from "./WorktreeChip";
import type { WorktreeMark } from "./worktreeMarks";
import styles from "./Graph.module.css";

export interface GraphRowProps {
  row: Row;
  /** Repo of this graph; enables pull request badges on branch chips. */
  repoId?: RepoId;
  commit: Commit;
  refs: Ref[];
  /** Other linked worktrees that have this commit checked out (always shown, never collapsed). */
  worktrees: readonly WorktreeMark[];
  lanes: number;
  /** Pixel offset from the top of the scroll area (virtualizer). */
  top: number;
  selected: boolean;
  hovered: boolean;
  isHead: boolean;
  wipAbove?: boolean;
  /** Stable object: the WIP connector crosses this stash row. */
  wipThrough?: { lane: number; color: number };
  /** HEAD with commits above it: the WIP connector comes down this lane and bends into the node. */
  wipJoin?: { lane: number; color: number };
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
  repoId,
  commit,
  refs,
  worktrees,
  lanes,
  top,
  selected,
  hovered,
  isHead,
  wipAbove = false,
  wipThrough,
  wipJoin,
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
  const isStash = commit.stash;
  const isMerge = !isStash && commit.parents.length > 1;
  const avatarUrl = useAuthorAvatar(commit.authorEmail, repoId);
  const items = useMemo(() => chipItems(refs), [refs]);
  const shown = expanded ? items : items.slice(0, MAX_CHIPS);
  const hidden = items.length - shown.length;
  const first = shown[0];
  const hasHeadChip = first?.gitRef.kind === "localBranch" && first.gitRef.isHead;
  const rest = hasHeadChip ? shown.slice(1) : shown;
  const chip = (it: (typeof shown)[number]) => {
    const r = it.gitRef;
    const local = r.kind === "localBranch";
    const isBranch = local || (typeof r.kind === "object" && "remoteBranch" in r.kind);
    return (
      <Fragment key={r.fullName}>
        <RefChip
          {...(repoId !== undefined ? { repoId } : {})}
          gitRef={r}
          withUpstream={it.withUpstream}
          remotes={it.remotes}
          {...(onRefContextMenu !== undefined ? { onContextMenu: onRefContextMenu } : {})}
          {...(onRefDrop !== undefined ? { onBranchDrop: onRefDrop } : {})}
        />
        {repoId !== undefined && isBranch && (
          <PrBadge repoId={repoId} name={local ? r.name : remoteTrackingName(r)} />
        )}
      </Fragment>
    );
  };
  const headChip = hasHeadChip && first !== undefined ? chip(first) : null;
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
        {(shown.length > 0 || worktrees.length > 0) && (
          <span
            className={expanded ? styles["refsOverlay"] : styles["refsInline"]}
            data-refs-overlay={expanded ? "" : undefined}
          >
            {headChip}
            {worktrees.map((w) => (
              <WorktreeChip key={w.path} mark={w} />
            ))}
            {rest.map(chip)}
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
            {!expanded && (
              <span
                className={`${styles["connector"]} ${isHead ? "" : styles["connectorThin"]} ${styles[`lane${colorIndex(row.color)}`]}`}
                aria-hidden
              />
            )}
          </span>
        )}
      </span>
      <LaneStrip
        row={row}
        lanes={lanes}
        isHead={isHead}
        wipAbove={wipAbove}
        isStash={isStash}
        {...(wipThrough !== undefined ? { wipThrough } : {})}
        {...(wipJoin !== undefined ? { wipJoin } : {})}
        isMerge={isMerge}
        initials={initials(commit.authorName)}
        avatarIdx={avatarColor(commit.authorEmail)}
        connector={!expanded && (shown.length > 0 || worktrees.length > 0)}
        avatarUrl={avatarUrl}
      />
      <span className={styles["messageCell"]}>
        <span className={`${styles["bar"]} ${styles[`lane${colorIndex(row.color)}`]}`} />
        <span
          className={
            isStash
              ? `${styles["subject"]} ${styles["stashSubject"]}`
              : isMerge
                ? `${styles["subject"]} ${styles["mergeSubject"]}`
                : styles["subject"]
          }
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
