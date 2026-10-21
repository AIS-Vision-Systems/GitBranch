import { memo, type DragEvent, type MouseEvent } from "react";
import type { Ref, RepoId } from "../../ipc/types";
import { useOpsStore } from "../../state/ops";
import { acceptDrag, endDrag, leaveDrag, startDrag, takeDrop } from "./dnd";
import { CheckIcon, CloudIcon, LaptopIcon, TagIcon } from "./icons";
import { remoteTrackingName } from "./menus";
import styles from "./Graph.module.css";

interface Props {
  gitRef: Ref;
  /** Needed for double-click checkout. */
  repoId?: RepoId;
  /** Stable callback; receives the chip's own ref. */
  onContextMenu?: (e: MouseEvent, gitRef: Ref) => void;
  /** Stable callback: a local branch named `source` was dropped on this chip. */
  onBranchDrop?: (source: string, target: Ref) => void;
  /** The branch's upstream chip was folded into this one: show the cloud icon. */
  withUpstream?: boolean;
}

export const RefChip = memo(function RefChip({
  gitRef,
  repoId,
  onContextMenu,
  onBranchDrop,
  withUpstream = false,
}: Props) {
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
  const onDouble =
    repoId === undefined || (kind === "localBranch" && isHead)
      ? undefined
      : (e: MouseEvent): void => {
          e.stopPropagation();
          void useOpsStore
            .getState()
            .checkout(repoId, kind === "localBranch" ? name : remoteTrackingName(gitRef));
        };
  if (kind === "localBranch") {
    const gone = upstream?.gone === true;
    const cls = [
      styles["chip"],
      styles["local"],
      isHead ? styles["head"] : "",
      gone ? styles["gone"] : "",
    ];
    const ahead = upstream !== null && !upstream.gone ? upstream.ahead : 0;
    const behind = upstream !== null && !upstream.gone ? upstream.behind : 0;
    return (
      <span
        className={cls.join(" ")}
        onContextMenu={onMenu}
        onDoubleClick={onDouble}
        draggable
        onDragStart={(e) => startDrag(e, name)}
        onDragEnd={endDrag}
        {...dropProps}
        title={
          (gone ? `${name} (upstream ${upstream?.name ?? ""} is gone)` : name) +
          (onDouble !== undefined ? "\nDouble-click to checkout" : "")
        }
      >
        {isHead && <CheckIcon />}
        <LaptopIcon />
        {name}
        {withUpstream && <CloudIcon />}
        {(ahead > 0 || behind > 0) && (
          <span className={styles["sync"]}>
            {ahead > 0 && `↑${ahead}`}
            {ahead > 0 && behind > 0 && " "}
            {behind > 0 && `↓${behind}`}
          </span>
        )}
      </span>
    );
  }
  if (typeof kind === "object" && "remoteBranch" in kind) {
    const label = remoteTrackingName(gitRef);
    const cut = label.indexOf("/") + 1;
    return (
      <span
        className={`${styles["chip"]} ${styles["remote"]}`}
        title={onDouble !== undefined ? `${label}\nDouble-click to checkout` : label}
        onContextMenu={onMenu}
        onDoubleClick={onDouble}
        {...dropProps}
      >
        <CloudIcon />
        <span>
          <span className={styles["remotePrefix"]}>{label.slice(0, cut)}</span>
          {label.slice(cut)}
        </span>
      </span>
    );
  }
  return (
    <span
      className={`${styles["chip"]} ${styles["tag"]}`}
      title={`tag ${name}`}
      onContextMenu={onMenu}
    >
      <TagIcon />
      {name}
    </span>
  );
});
