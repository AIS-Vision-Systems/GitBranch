import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useReposStore } from "../../state/repos";
import { ChevronDown, FolderGit2, GitFork, Plus, X } from "../../lib/icons";
import { pathKey } from "../../lib/paths";
import { groupTabs, orderTabs, tabName } from "../../lib/tabOrder";
import type { OpenedRepo } from "../../ipc/types";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { useContextMenu } from "./useContextMenu";
import { TabAliasBar } from "./TabAliasBar";
import { TabSearchMenu } from "./TabSearchMenu";
import styles from "./RepoTabs.module.css";

const tabDomId = (repoId: string): string => `repo-tab-${repoId}`;
const DRAG_TYPE = "application/x-gitbranch-tab";

interface DropMark {
  repoId: string;
  side: "before" | "after";
}

export function RepoTabs() {
  const open = useReposStore((s) => s.open);
  const aliases = useReposStore((s) => s.aliases);
  const currentId = useReposStore((s) => s.currentId);
  const select = useReposStore((s) => s.select);
  const close = useReposStore((s) => s.close);
  const closeOthers = useReposStore((s) => s.closeOthers);
  const closeRight = useReposStore((s) => s.closeRight);
  const setAlias = useReposStore((s) => s.setAlias);
  const moveTab = useReposStore((s) => s.moveTab);
  const newTab = useReposStore((s) => s.newTab);
  const tabs = useMemo(() => orderTabs(open), [open]);
  const ctx = useContextMenu<OpenedRepo>();
  const [aliasing, setAliasing] = useState<OpenedRepo | null>(null);
  const [dropdownAt, setDropdownAt] = useState<{ x: number; y: number } | null>(null);
  const [mark, setMark] = useState<DropMark | null>(null);
  const dragId = useRef<string | null>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, repoId: string): void => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(repoId);
      return;
    }
    const i = tabs.findIndex((r) => r.repoId === repoId);
    let to = -1;
    if (e.key === "ArrowRight") to = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") to = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = tabs.length - 1;
    const target = tabs[to];
    if (target === undefined) return;
    e.preventDefault();
    select(target.repoId);
    document.getElementById(tabDomId(target.repoId))?.focus();
  };

  const sideOf = (e: DragEvent<HTMLElement>): "before" | "after" => {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientX < rect.left + rect.width / 2 ? "before" : "after";
  };

  const onDrop = (e: DragEvent<HTMLElement>, targetId: string): void => {
    const id = dragId.current;
    const side = sideOf(e);
    e.preventDefault();
    dragId.current = null;
    setMark(null);
    if (id === null || id === targetId) return;
    // Groups (main checkout + worktrees) move as a unit: index among the groups without the dragged one.
    const others = groupTabs(open).filter((g) => !g.some((r) => r.repoId === id));
    const t = others.findIndex((g) => g.some((r) => r.repoId === targetId));
    if (t < 0) return;
    moveTab(id, side === "before" ? t : t + 1);
  };

  const menuItems = (r: OpenedRepo): MenuItem[] => {
    const i = tabs.findIndex((t) => t.repoId === r.repoId);
    return [
      { kind: "item", id: "close", label: "Close tab", onSelect: () => void close(r.repoId) },
      {
        kind: "item",
        id: "close-others",
        label: "Close other tabs",
        disabled: tabs.length < 2,
        onSelect: () => void closeOthers(r.repoId),
      },
      {
        kind: "item",
        id: "close-right",
        label: "Close tabs to the right",
        disabled: i >= tabs.length - 1,
        onSelect: () => void closeRight(r.repoId),
      },
      { kind: "separator" },
      { kind: "item", id: "alias", label: "Alias repository", onSelect: () => setAliasing(r) },
    ];
  };

  const closeAlias = (repoId: string): void => {
    setAliasing(null);
    // The tab row is re-rendered after the bar goes away; focus the tab once it exists again.
    requestAnimationFrame(() => document.getElementById(tabDomId(repoId))?.focus());
  };

  if (aliasing !== null) {
    return (
      <TabAliasBar
        current={aliases[pathKey(aliasing.path)] ?? ""}
        onSave={(value) => {
          setAlias(aliasing.path, value);
          closeAlias(aliasing.repoId);
        }}
        onClear={() => {
          setAlias(aliasing.path, null);
          closeAlias(aliasing.repoId);
        }}
        onCancel={() => closeAlias(aliasing.repoId)}
      />
    );
  }

  return (
    <div role="tablist" aria-label="Open repositories" className={styles["tabs"]}>
      {tabs.map((r) => {
        const active = r.repoId === currentId;
        const name = tabName(r, aliases);
        const title =
          r.isWorktree && r.mainWorkTree !== null ? `Worktree of ${r.mainWorkTree}` : r.path;
        const dropCls =
          mark?.repoId === r.repoId
            ? mark.side === "before"
              ? styles["dropBefore"]
              : styles["dropAfter"]
            : "";
        const cls = [styles["entry"], active ? styles["entryActive"] : "", dropCls].join(" ");
        return (
          <div
            key={r.repoId}
            className={cls}
            draggable
            onContextMenu={(e) => ctx.open(e, r)}
            onDragStart={(e) => {
              dragId.current = r.repoId;
              e.dataTransfer.setData(DRAG_TYPE, r.repoId);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => {
              dragId.current = null;
              setMark(null);
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const side = sideOf(e);
              if (mark?.repoId !== r.repoId || mark.side !== side) {
                setMark({ repoId: r.repoId, side });
              }
            }}
            onDrop={(e) => onDrop(e, r.repoId)}
          >
            <div
              id={tabDomId(r.repoId)}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={title}
              className={active ? `${styles["tab"]} ${styles["active"]}` : styles["tab"]}
              onClick={() => select(r.repoId)}
              onKeyDown={(e) => onKeyDown(e, r.repoId)}
            >
              {r.isWorktree ? (
                <GitFork size={16} className={styles["icon"]} aria-hidden="true" />
              ) : (
                <FolderGit2 size={16} className={styles["icon"]} aria-hidden="true" />
              )}
              <span className={styles["label"]}>{name}</span>
              {r.isBare && <span className={styles["bare"]}>(bare)</span>}
            </div>
            <button
              type="button"
              tabIndex={-1}
              className={styles["close"]}
              aria-label={`Close ${name}`}
              title={`Close ${name}`}
              onClick={() => void close(r.repoId)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className={styles["newTab"]}
        aria-label="New tab"
        title="Open or clone a repository"
        onClick={newTab}
      >
        <Plus size={16} aria-hidden="true" />
      </button>
      <button
        ref={chevronRef}
        type="button"
        className={styles["newTab"]}
        aria-label="Search tabs"
        aria-haspopup="dialog"
        title="Search open tabs"
        onClick={() => {
          const rect = chevronRef.current?.getBoundingClientRect();
          if (rect !== undefined) setDropdownAt({ x: rect.right, y: rect.bottom });
        }}
      >
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {dropdownAt !== null && (
        <TabSearchMenu
          x={dropdownAt.x}
          y={dropdownAt.y}
          tabs={tabs}
          aliases={aliases}
          currentId={currentId}
          onSelect={select}
          onCloseTab={(id) => void close(id)}
          onClose={() => setDropdownAt(null)}
        />
      )}
      {ctx.menu !== null && (
        <ContextMenu
          x={ctx.menu.x}
          y={ctx.menu.y}
          items={menuItems(ctx.menu.data)}
          onClose={ctx.close}
        />
      )}
    </div>
  );
}
