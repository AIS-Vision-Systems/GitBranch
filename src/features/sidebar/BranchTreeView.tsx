import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import type { Ref, RepoId } from "../../ipc/types";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Folder } from "../../lib/icons";
import { useGraphStore } from "../../state/graph";
import { ContextMenu } from "../shell/ContextMenu";
import { useContextMenu } from "../shell/useContextMenu";
import type { BranchFolder, BranchLeaf, BranchNode } from "./branchTree";
import { checkoutRef, menuItemsFor } from "./refActions";
import styles from "./Sidebar.module.css";

const NO_EXPAND: ReadonlySet<string> = new Set();
const INDENT = 12;

interface FlatRow {
  key: string;
  level: number;
  parentKey: string | null;
  node: BranchNode;
  expanded: boolean;
}

function flatten(
  nodes: BranchNode[],
  level: number,
  parentKey: string | null,
  isOpen: (path: string) => boolean,
  out: FlatRow[],
): FlatRow[] {
  for (const node of nodes) {
    if (node.kind === "leaf") {
      out.push({ key: `l:${node.path}`, level, parentKey, node, expanded: false });
    } else {
      const key = `f:${node.path}`;
      const expanded = isOpen(node.path);
      out.push({ key, level, parentKey, node, expanded });
      if (expanded) flatten(node.children, level + 1, key, isOpen, out);
    }
  }
  return out;
}

const pad = (level: number): string => `calc(var(--section-indent) + ${(level - 1) * INDENT}px)`;

function Leaf({
  repoId,
  leaf,
  level,
  rowKey,
  tabIndex,
  onMenu,
  onActive,
}: {
  repoId: RepoId;
  leaf: BranchLeaf;
  level: number;
  rowKey: string;
  tabIndex: number;
  onMenu: (e: MouseEvent, ref: Ref) => void;
  onActive: (key: string) => void;
}) {
  const select = useGraphStore((s) => s.select);
  const setHover = useGraphStore((s) => s.setHover);
  const selected = useGraphStore((s) => s.selectedOid === leaf.ref.target);
  const { ref } = leaf;
  const up = ref.upstream;

  // A row removed while hovered never gets its mouseleave: do not leave the highlight stuck.
  useEffect(
    () => () => {
      if (useGraphStore.getState().hoverOid === ref.target) setHover(null);
    },
    [ref.target, setHover],
  );

  return (
    <div
      role="treeitem"
      aria-level={level}
      aria-selected={selected}
      aria-current={ref.isHead ? "true" : undefined}
      data-key={rowKey}
      tabIndex={tabIndex}
      className={`${styles["treeRow"]} ${selected ? styles["rowCurrent"] : ""}`}
      style={{ paddingLeft: pad(level) }}
      title={ref.name}
      onClick={() => {
        onActive(rowKey);
        select(ref.target);
      }}
      onFocus={() => onActive(rowKey)}
      onDoubleClick={() => checkoutRef(repoId, ref)}
      onContextMenu={(e) => onMenu(e, ref)}
      onMouseEnter={() => setHover(ref.target)}
      onMouseLeave={() => setHover(null)}
    >
      <span className={styles["treeLead"]} aria-hidden="true">
        {ref.isHead && <Check size={14} data-testid="head-check" />}
      </span>
      <span className={`${styles["treeName"]} ${ref.isHead ? styles["treeNameHead"] : ""}`}>
        {leaf.name}
      </span>
      {up !== null && up.gone && <span className={styles["badge"]}>gone</span>}
      {up !== null && !up.gone && up.ahead > 0 && (
        <span className={styles["badge"]} title={`${up.ahead} ahead`}>
          <ArrowUp size={10} aria-hidden />
          {up.ahead}
        </span>
      )}
      {up !== null && !up.gone && up.behind > 0 && (
        <span className={styles["badge"]} title={`${up.behind} behind`}>
          <ArrowDown size={10} aria-hidden />
          {up.behind}
        </span>
      )}
    </div>
  );
}

function FolderRow({
  folder,
  row,
  tabIndex,
  onToggle,
  onActive,
}: {
  folder: BranchFolder;
  row: FlatRow;
  tabIndex: number;
  onToggle: (path: string) => void;
  onActive: (key: string) => void;
}) {
  return (
    <div
      role="treeitem"
      aria-level={row.level}
      aria-expanded={row.expanded}
      data-key={row.key}
      tabIndex={tabIndex}
      className={styles["treeRow"]}
      style={{ paddingLeft: pad(row.level) }}
      onClick={() => {
        onActive(row.key);
        onToggle(folder.path);
      }}
      onFocus={() => onActive(row.key)}
    >
      <span className={styles["treeLead"]} aria-hidden="true">
        {row.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </span>
      <Folder size={14} aria-hidden className={styles["treeFolder"]} />
      <span className={styles["treeName"]}>{folder.name}</span>
    </div>
  );
}

interface TreeProps {
  repoId: RepoId;
  nodes: BranchNode[];
  /** Folder paths forced open (filter matches). */
  expand?: ReadonlySet<string>;
}

export function BranchTree({ repoId, nodes, expand = NO_EXPAND }: TreeProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const ctxMenu = useContextMenu<Ref>();
  const treeRef = useRef<HTMLDivElement>(null);

  const isOpen = (path: string): boolean => open.has(path) || expand.has(path);
  const flat = flatten(nodes, 1, null, isOpen, []);
  const active = flat.some((r) => r.key === activeKey) ? activeKey : (flat[0]?.key ?? null);

  const setFolder = (path: string, value: boolean): void =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (value) next.add(path);
      else next.delete(path);
      return next;
    });
  const toggle = (path: string): void => setFolder(path, !isOpen(path));

  const focusRow = (key: string | undefined): void => {
    if (key === undefined) return;
    setActiveKey(key);
    const els = treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]');
    els?.forEach((el) => {
      if (el.dataset["key"] === key) el.focus();
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const el = e.target;
    if (!(el instanceof HTMLElement) || el.getAttribute("role") !== "treeitem") return;
    const idx = flat.findIndex((r) => r.key === el.dataset["key"]);
    const row = flat[idx];
    if (row === undefined) return;
    const { node } = row;
    const stop = (): void => e.preventDefault();

    if (e.key === "ArrowDown") {
      stop();
      focusRow(flat[idx + 1]?.key);
    } else if (e.key === "ArrowUp") {
      stop();
      focusRow(flat[idx - 1]?.key);
    } else if (e.key === "Home") {
      stop();
      focusRow(flat[0]?.key);
    } else if (e.key === "End") {
      stop();
      focusRow(flat[flat.length - 1]?.key);
    } else if (e.key === "ArrowRight" && node.kind === "folder") {
      stop();
      if (!row.expanded) setFolder(node.path, true);
      else if (flat[idx + 1]?.parentKey === row.key) focusRow(flat[idx + 1]?.key);
    } else if (e.key === "ArrowLeft") {
      stop();
      if (node.kind === "folder" && row.expanded && !expand.has(node.path)) {
        setFolder(node.path, false);
      } else if (row.parentKey !== null) {
        focusRow(row.parentKey);
      }
    } else if (node.kind === "folder" && (e.key === "Enter" || e.key === " ")) {
      stop();
      toggle(node.path);
    } else if (node.kind === "leaf" && e.key === "Enter") {
      stop();
      checkoutRef(repoId, node.ref);
    } else if (node.kind === "leaf" && e.key === " ") {
      stop();
      useGraphStore.getState().select(node.ref.target);
    } else if (
      node.kind === "leaf" &&
      (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))
    ) {
      stop();
      const r = el.getBoundingClientRect();
      ctxMenu.openAt(r.left + 24, r.bottom, node.ref);
    }
  };

  const items = ctxMenu.menu === null ? null : menuItemsFor(repoId, ctxMenu.menu.data);
  return (
    <div ref={treeRef} role="tree" aria-label="Branches" onKeyDown={onKeyDown}>
      {flat.map((row) => {
        const tabIndex = row.key === active ? 0 : -1;
        return row.node.kind === "leaf" ? (
          <Leaf
            key={row.key}
            repoId={repoId}
            leaf={row.node}
            level={row.level}
            rowKey={row.key}
            tabIndex={tabIndex}
            onMenu={ctxMenu.open}
            onActive={setActiveKey}
          />
        ) : (
          <FolderRow
            key={row.key}
            folder={row.node}
            row={row}
            tabIndex={tabIndex}
            onToggle={toggle}
            onActive={setActiveKey}
          />
        );
      })}
      {ctxMenu.menu !== null && items !== null && (
        <ContextMenu x={ctxMenu.menu.x} y={ctxMenu.menu.y} items={items} onClose={ctxMenu.close} />
      )}
    </div>
  );
}
