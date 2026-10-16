import { memo, type DragEvent, type MouseEvent } from "react";
import type { Ref } from "../../ipc/types";
import { acceptDrag, endDrag, leaveDrag, startDrag, takeDrop } from "./dnd";
import { remoteTrackingName } from "./menus";
import styles from "./Graph.module.css";

interface Props {
  gitRef: Ref;
  /** Stable callback; receives the chip's own ref. */
  onContextMenu?: (e: MouseEvent, gitRef: Ref) => void;
  /** Stable callback: a local branch named `source` was dropped on this chip. */
  onBranchDrop?: (source: string, target: Ref) => void;
}

export const RefChip = memo(function RefChip({ gitRef, onContextMenu, onBranchDrop }: Props) {
  const hl = styles["dropTarget"];
  const own = (source: string): boolean => gitRef.kind === "localBranch" && gitRef.name === source;
  const dropProps =
    onBranchDrop === undefined
      ? {}
      : {
          onDragOver: (e: DragEvent<HTMLElement>) => acceptDrag(e, hl, own),
          onDragLeave: (e: DragEvent<HTMLElement>) => leaveDrag(e, hl),
          onDrop: (e: DragEvent<HTMLElement>) => {
            const source = takeDrop(e, hl, own);
            if (source !== null) onBranchDrop(source, gitRef);
          },
        };
  const onMenu =
    onContextMenu === undefined
      ? undefined
      : (e: MouseEvent): void => {
          e.stopPropagation();
          onContextMenu(e, gitRef);
        };
  const { kind, name, upstream, isHead } = gitRef;
  if (kind === "localBranch") {
    const gone = upstream?.gone === true;
    const cls = [
      styles["chip"],
      styles["local"],
      isHead ? styles["head"] : "",
      gone ? styles["gone"] : "",
    ];
    return (
      <span
        className={cls.join(" ")}
        onContextMenu={onMenu}
        draggable
        onDragStart={(e) => startDrag(e, name)}
        onDragEnd={endDrag}
        {...dropProps}
        title={gone ? `${name} (upstream ${upstream?.name ?? ""} is gone)` : name}
      >
        {name}
        {upstream !== null && !upstream.gone && (upstream.ahead > 0 || upstream.behind > 0) && (
          <span className={styles["sync"]}>
            {upstream.ahead > 0 && ` ↑${upstream.ahead}`}
            {upstream.behind > 0 && ` ↓${upstream.behind}`}
          </span>
        )}
      </span>
    );
  }
  if (typeof kind === "object" && "remoteBranch" in kind) {
    const label = remoteTrackingName(gitRef);
    return (
      <span
        className={`${styles["chip"]} ${styles["remote"]}`}
        title={label}
        onContextMenu={onMenu}
        {...dropProps}
      >
        {label}
      </span>
    );
  }
  return (
    <span
      className={`${styles["chip"]} ${styles["tag"]}`}
      title={`tag ${name}`}
      onContextMenu={onMenu}
    >
      {name}
    </span>
  );
});
