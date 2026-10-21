import { useMemo, useState, type ReactNode } from "react";
import { buildTree, type TreeNode } from "../../lib/fileTree";
import { Item, type FileListItem } from "./FileList";
import styles from "./Commit.module.css";

export interface FileTreeProps {
  files: FileListItem[];
  selectedKey: string | null;
  onSelect: (item: FileListItem) => void;
  actions?: (item: FileListItem) => ReactNode;
  ariaLabel?: string;
}

/** Files nested by directory; folders collapse (state lives here, so per section). */
export function FileTree({ files, selectedKey, onSelect, actions, ariaLabel }: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (path: string): void =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (!n.delete(path)) n.add(path);
      return n;
    });

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
      const open = !collapsed.has(n.path);
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
            {n.name}
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
