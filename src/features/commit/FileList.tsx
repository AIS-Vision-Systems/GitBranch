import { memo } from "react";
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
}: {
  item: FileListItem;
  selected: boolean;
  onSelect: (item: FileListItem) => void;
}) {
  return (
    <div role="listitem">
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
    </div>
  );
});

export interface FileListProps {
  files: FileListItem[];
  selectedKey: string | null;
  onSelect: (item: FileListItem) => void;
}

export function FileList({ files, selectedKey, onSelect }: FileListProps) {
  if (files.length === 0) return <p className={styles["empty"]}>No changed files</p>;
  return (
    <div role="list" aria-label="Changed files" className={styles["fileList"]}>
      {files.map((f) => (
        <Item key={f.key} item={f} selected={f.key === selectedKey} onSelect={onSelect} />
      ))}
    </div>
  );
}
