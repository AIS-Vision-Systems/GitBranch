import { memo, type ReactNode } from "react";
import type { ChangeKind, DiffTarget } from "../../ipc/commit";
import styles from "./Commit.module.css";

export interface FileListItem {
  key: string;
  path: string;
  origPath: string | null;
  kind: ChangeKind;
  /** Extra text after the path, e.g. "(staged)". */
  suffix?: string;
  target: DiffTarget;
  /** Label shown in the diff toolbar. */
  label: string;
  /** Unmerged entry (listed under Conflicts in the WIP pane). */
  conflicted?: boolean;
}

const BADGE: Record<ChangeKind, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  typeChanged: "T",
  unmerged: "U",
  unknown: "?",
};

const BADGE_CLASS: Record<ChangeKind, string> = {
  added: "badgeAdded",
  modified: "badgeModified",
  deleted: "badgeDeleted",
  renamed: "badgeMoved",
  copied: "badgeMoved",
  typeChanged: "badgeModified",
  unmerged: "badgeDeleted",
  unknown: "badgeModified",
};

function PathLabel({ path }: { path: string }) {
  const i = path.lastIndexOf("/");
  return (
    <>
      {i >= 0 && <span className={styles["dir"]}>{path.slice(0, i + 1)}</span>}
      <span className={styles["file"]}>{path.slice(i + 1)}</span>
    </>
  );
}

const Item = memo(function Item({
  item,
  selected,
  onSelect,
  actions,
}: {
  item: FileListItem;
  selected: boolean;
  onSelect: (item: FileListItem) => void;
  actions?: (item: FileListItem) => ReactNode;
}) {
  return (
    <div role="listitem" className={styles["fileItem"]}>
      <button
        type="button"
        className={
          selected ? `${styles["fileRow"]} ${styles["fileRowSelected"]}` : styles["fileRow"]
        }
        aria-current={selected ? "true" : undefined}
        title={item.origPath !== null ? `${item.origPath} → ${item.path}` : item.path}
        onClick={() => onSelect(item)}
      >
        <span
          className={`${styles["badge"]} ${styles[BADGE_CLASS[item.kind]]}`}
          aria-label={item.kind}
        >
          {BADGE[item.kind]}
        </span>
        <span className={styles["filePath"]}>
          {item.origPath !== null && (
            <>
              <PathLabel path={item.origPath} />
              <span className={styles["arrow"]}> → </span>
            </>
          )}
          <PathLabel path={item.path} />
          {item.suffix !== undefined && <span className={styles["suffix"]}> {item.suffix}</span>}
        </span>
      </button>
      {actions !== undefined && <div className={styles["actions"]}>{actions(item)}</div>}
    </div>
  );
});

export interface FileListProps {
  files: FileListItem[];
  selectedKey: string | null;
  onSelect: (item: FileListItem) => void;
  /** Optional hover/focus action buttons rendered at the right of each row. */
  actions?: (item: FileListItem) => ReactNode;
  ariaLabel?: string;
  /** Text shown when empty; null renders nothing. */
  emptyText?: string | null;
}

export function FileList({
  files,
  selectedKey,
  onSelect,
  actions,
  ariaLabel = "Changed files",
  emptyText = "No changed files",
}: FileListProps) {
  if (files.length === 0) {
    return emptyText === null ? null : <p className={styles["empty"]}>{emptyText}</p>;
  }
  return (
    <div role="list" aria-label={ariaLabel} className={styles["fileList"]}>
      {files.map((f) => (
        <Item
          key={f.key}
          item={f}
          selected={f.key === selectedKey}
          onSelect={onSelect}
          {...(actions !== undefined ? { actions } : {})}
        />
      ))}
    </div>
  );
}
