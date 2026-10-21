import { useMemo, type ReactNode } from "react";
import {
  buildTree,
  dirPaths,
  statusOf,
  type StatusCounts,
  type TreeNode,
} from "../../lib/fileTree";
import { Item, type FileListItem } from "./FileList";
import type { Expanded } from "./treeState";
import styles from "./Commit.module.css";

export function TreeModeToggle({
  tree,
  onChange,
}: {
  tree: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={styles["viewToggle"]} role="group" aria-label="File view">
      <button
        type="button"
        className={styles["headerAction"]}
        aria-pressed={tree}
        onClick={() => onChange(true)}
      >
        Tree
      </button>
      <button
        type="button"
        className={styles["headerAction"]}
        aria-pressed={!tree}
        onClick={() => onChange(false)}
      >
        Flat
      </button>
    </div>
  );
}

export function ExpandLink({
  expanded,
  onChange,
}: {
  expanded: Expanded;
  onChange: (e: Expanded) => void;
}) {
  const all = expanded === "all";
  return (
    <button
      type="button"
      className={styles["linkAction"]}
      onClick={() => onChange(all ? new Set<string>() : "all")}
    >
      {all ? "Collapse all" : "Expand all"}
    </button>
  );
}

/** Small status icons with counts: pencil (modified), + (added), − (deleted), plus renamed and conflicts. */
export function CountBadges({ counts }: { counts: StatusCounts }) {
  const parts: [string, string, number, string][] = [
    ["✎", "modified", counts.modified, "countModified"],
    ["+", "added", counts.added, "countAdded"],
    ["−", "deleted", counts.deleted, "countDeleted"],
    ["→", "renamed", counts.renamed, "countMoved"],
    ["!", "conflicted", counts.conflicted, "countDeleted"],
  ];
  return (
    <span className={styles["counts"]}>
      {parts
        .filter((p) => p[2] > 0)
        .map(([icon, label, n, cls]) => (
          <span
            key={label}
            className={`${styles["countItem"]} ${styles[cls] ?? ""}`}
            title={`${n} ${label}`}
          >
            <span aria-hidden="true">{icon}</span> {n}
          </span>
        ))}
    </span>
  );
}

export interface FileTreeProps {
  files: FileListItem[];
  selectedKey: string | null;
  onSelect: (item: FileListItem) => void;
  actions?: (item: FileListItem) => ReactNode;
  ariaLabel?: string;
  /** Controlled by the parent so it can offer Expand all / Collapse all. */
  expanded: Expanded;
  onExpandedChange: (e: Expanded) => void;
}

/** Files nested by directory (folders first); folder rows show aggregated status counts. */
export function FileTree({
  files,
  selectedKey,
  onSelect,
  actions,
  ariaLabel,
  expanded,
  onExpandedChange,
}: FileTreeProps) {
  const tree = useMemo(() => buildTree(files, statusOf), [files]);
  const isOpen = (path: string): boolean => expanded === "all" || expanded.has(path);
  const toggle = (path: string): void => {
    const next = new Set<string>(expanded === "all" ? dirPaths(tree) : expanded);
    if (!next.delete(path)) next.add(path);
    onExpandedChange(next);
  };

  const render = (nodes: TreeNode<FileListItem>[], depth: number): ReactNode =>
    nodes.map((n) => {
      if (n.kind === "file") {
        return (
          <Item
            key={n.item.key}
            item={n.item}
            depth={depth}
            selected={n.item.key === selectedKey}
            onSelect={onSelect}
            {...(actions !== undefined ? { actions } : {})}
          />
        );
      }
      const open = isOpen(n.path);
      return (
        <div key={`d:${n.path}`} role="group">
          <button
            type="button"
            className={styles["dirRow"]}
            style={{ paddingLeft: `calc(var(--space-3) + ${depth} * var(--space-3))` }}
            aria-expanded={open}
            title={n.path}
            onClick={() => toggle(n.path)}
          >
            <span className={styles["caret"]} aria-hidden="true">
              {open ? "▾" : "▸"}
            </span>
            <span className={styles["dirName"]}>{n.name}</span>
            <CountBadges counts={n.counts} />
          </button>
          {open && render(n.children, depth + 1)}
        </div>
      );
    });

  return (
    <div role="list" aria-label={ariaLabel} className={styles["fileList"]}>
      {render(tree, 0)}
    </div>
  );
}
