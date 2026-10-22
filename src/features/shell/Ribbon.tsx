import { useEffect, useMemo, useState } from "react";
import { openTerminal } from "../../ipc/conflict";
import type { PullMode } from "../../ipc/remote";
import type { RepoId } from "../../ipc/types";
import { isEditableTarget } from "../../lib/keys";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Download,
  Ellipsis,
  FolderGit2,
  GitBranch,
  GitBranchPlus,
  Redo2,
  Search,
  SquareTerminal,
  Undo2,
  Upload,
  type LucideIcon,
} from "../../lib/icons";
import { useDialogsStore } from "../../state/dialogs";
import { useGraphStore } from "../../state/graph";
import { shortOid, undoCommand, useOpsStore } from "../../state/ops";
import { remotesOf, useRemotesStore } from "../../state/remotes";
import { useReposStore } from "../../state/repos";
import { reportError, useUiStore } from "../../state/ui";
import {
  openClone,
  openCreateBranch,
  openPull,
  openPush,
  openRemotes,
  openSettings,
  openStashPush,
} from "../dialogs/open";
import { StashList } from "../stash/StashList";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { Popover } from "./Popover";
import styles from "./Ribbon.module.css";

interface Props {
  repoId: RepoId;
}

const FETCH_ALL = { remote: null, prune: false, tags: false };
const ICON = 18;

type MenuKind = "repo" | "fetch" | "actions";
interface Anchor {
  x: number;
  y: number;
}

function anchorOf(el: HTMLElement): Anchor {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.bottom + 2 };
}

function syncText(ahead: number, behind: number): string {
  return [ahead > 0 ? `↑${ahead}` : "", behind > 0 ? `↓${behind}` : ""].filter(Boolean).join(" ");
}

/** Shortcuts must not fire from inputs, modals, or while a dialog is open. */
function hotkeyBlocked(e: KeyboardEvent): boolean {
  if (e.repeat || useDialogsStore.getState().current !== null) return true;
  const t = e.target;
  return (
    isEditableTarget(t) || (t instanceof HTMLElement && t.closest('[aria-modal="true"]') !== null)
  );
}

interface RibbonButtonProps {
  icon: LucideIcon;
  label: string;
  title?: string;
  disabled?: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  haspopup?: boolean;
}

function RibbonButton({
  icon: Icon,
  label,
  title,
  disabled,
  onClick,
  haspopup,
}: RibbonButtonProps) {
  return (
    <button
      type="button"
      className={styles["button"]}
      disabled={disabled === true}
      title={title ?? label}
      aria-haspopup={haspopup === true ? "menu" : undefined}
      onClick={onClick}
    >
      <Icon size={ICON} aria-hidden="true" />
      <span className={styles["label"]}>{label}</span>
    </button>
  );
}

interface BranchPickerProps {
  repoId: RepoId;
  anchor: Anchor;
  onClose: () => void;
}

function BranchPicker({ repoId, anchor, onClose }: BranchPickerProps) {
  const refs = useGraphStore((s) => s.byRepo[repoId]?.refs?.refs);
  const checkout = useOpsStore((s) => s.checkout);
  const [query, setQuery] = useState("");
  const branches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (refs ?? []).filter((r) => r.kind === "localBranch" && r.name.toLowerCase().includes(q));
  }, [refs, query]);
  return (
    <Popover x={anchor.x} y={anchor.y} label="Branches" onClose={onClose}>
      <input
        className={styles["filter"]}
        placeholder="Filter branches"
        aria-label="Filter branches"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {branches.length === 0 ? (
        <div className={styles["empty"]}>No matching branches</div>
      ) : (
        <ul className={styles["branchList"]}>
          {branches.map((b) => (
            <li key={b.fullName}>
              <button
                type="button"
                className={`${styles["branchItem"]} ${b.isHead ? styles["current"] : ""}`}
                onClick={() => {
                  onClose();
                  if (!b.isHead) void checkout(repoId, b.name);
                }}
              >
                <span>{b.name}</span>
                {b.upstream !== null && (b.upstream.ahead > 0 || b.upstream.behind > 0) && (
                  <span>{syncText(b.upstream.ahead, b.upstream.behind)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}

export function Ribbon({ repoId }: Props) {
  const repos = useReposStore((s) => s.open);
  const currentId = useReposStore((s) => s.currentId);
  const selectRepo = useReposStore((s) => s.select);
  const repoName = repos.find((r) => r.repoId === currentId)?.name ?? "Repository";

  const clean = useGraphStore((s) => (s.byRepo[repoId]?.status?.entries.length ?? 0) === 0);
  const stashes = useGraphStore((s) => s.byRepo[repoId]?.stashes);
  const head = useGraphStore((s) => s.byRepo[repoId]?.refs?.head ?? null);
  const headOid = head?.oid ?? null;
  const upstream = useGraphStore(
    (s) =>
      s.byRepo[repoId]?.refs?.refs.find((r) => r.kind === "localBranch" && r.isHead)?.upstream ??
      null,
  );
  const undo = useGraphStore((s) => s.byRepo[repoId]?.undo ?? null);
  const inProgress = useGraphStore((s) => s.byRepo[repoId]?.inProgress ?? null) !== null;
  const redo = useOpsStore((s) => s.redo[repoId] ?? null);
  const busy = useOpsStore((s) => s.busy);
  const fetchAll = useOpsStore((s) => s.fetch);
  const pull = useOpsStore((s) => s.pull);
  const undoLast = useOpsStore((s) => s.undoLast);
  const redoLast = useOpsStore((s) => s.redoLast);
  const stashPop = useOpsStore((s) => s.stashPop);
  const hasRemotes = useRemotesStore((s) => remotesOf(s, repoId).length > 0);
  const ahead = upstream?.ahead ?? 0;
  const stashCount = stashes?.length ?? 0;

  const [menu, setMenu] = useState<({ kind: MenuKind } & Anchor) | null>(null);
  const [branchAnchor, setBranchAnchor] = useState<Anchor | null>(null);
  const [stashAnchor, setStashAnchor] = useState<Anchor | null>(null);

  const noRemotes = "No remotes configured";
  const opBlocked = "Finish or abort the current operation first";

  useEffect(() => {
    if ((undo === null && redo === null) || inProgress) return;
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if ((k !== "z" || undo === null) && (k !== "y" || redo === null)) return;
      if (hotkeyBlocked(e)) return;
      e.preventDefault();
      if (useOpsStore.getState().busy) return;
      if (k === "z" && undo !== null) void undoLast(repoId, undo);
      else void redoLast(repoId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, inProgress, repoId, undoLast, redoLast]);

  useEffect(() => {
    if (!hasRemotes) return;
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "f" && key !== "l" && key !== "p") return;
      if (hotkeyBlocked(e)) return;
      e.preventDefault();
      if (useOpsStore.getState().busy) return;
      if (key === "l" && useGraphStore.getState().byRepo[repoId]?.inProgress) return;
      if (key === "f") void fetchAll(repoId, FETCH_ALL);
      else if (key === "l") openPull(repoId);
      else openPush(repoId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasRemotes, repoId, fetchAll]);

  const doPull = (mode: PullMode): void => void pull(repoId, { remote: null, branch: null, mode });
  const pullBlocked = busy || inProgress || !hasRemotes;

  const menuItems = (kind: MenuKind): MenuItem[] => {
    switch (kind) {
      case "repo":
        return repos.map((r) => ({
          kind: "item",
          id: r.repoId,
          label: r.name,
          ...(r.repoId === currentId ? { shortcut: "current" } : {}),
          onSelect: () => selectRepo(r.repoId),
        }));
      case "fetch":
        return [
          {
            kind: "item",
            id: "fetch-all",
            label: "Fetch all",
            shortcut: "Ctrl+Shift+F",
            disabled: busy || !hasRemotes,
            onSelect: () => void fetchAll(repoId, FETCH_ALL),
          },
          { kind: "separator" },
          {
            kind: "item",
            id: "pull-ff",
            label: "Pull (fast-forward)",
            disabled: pullBlocked,
            onSelect: () => doPull("ffOnly"),
          },
          {
            kind: "item",
            id: "pull-rebase",
            label: "Pull (rebase)",
            disabled: pullBlocked,
            onSelect: () => doPull("rebase"),
          },
          {
            kind: "item",
            id: "pull-merge",
            label: "Pull (merge)",
            disabled: pullBlocked,
            onSelect: () => doPull("merge"),
          },
          { kind: "separator" },
          {
            kind: "item",
            id: "prune",
            label: "Prune remote branches",
            disabled: busy || !hasRemotes,
            onSelect: () => void fetchAll(repoId, { remote: null, prune: true, tags: false }),
          },
        ];
      case "actions":
        return [
          {
            kind: "item",
            id: "clone",
            label: "Clone…",
            shortcut: "Ctrl+Shift+C",
            onSelect: () => openClone(),
          },
          { kind: "item", id: "remotes", label: "Remotes…", onSelect: () => openRemotes(repoId) },
          {
            kind: "item",
            id: "stashes",
            label: `Stashes (${stashCount})`,
            onSelect: () => {
              const r = document
                .querySelector<HTMLElement>('[aria-label="More actions"]')
                ?.getBoundingClientRect();
              setStashAnchor({ x: r?.right ?? window.innerWidth, y: (r?.bottom ?? 0) + 2 });
            },
          },
          {
            kind: "item",
            id: "sidebar",
            label: "Toggle sidebar",
            shortcut: "Ctrl+B",
            onSelect: () => useUiStore.getState().toggleSidebar(),
          },
          { kind: "separator" },
          {
            kind: "item",
            id: "settings",
            label: "Settings…",
            shortcut: "Ctrl+,",
            onSelect: () => openSettings(),
          },
        ];
    }
  };

  const open =
    (kind: MenuKind) =>
    (e: React.MouseEvent<HTMLElement>): void =>
      setMenu({ kind, ...anchorOf(e.currentTarget) });

  const branchLabel =
    head === null
      ? "No branch"
      : head.detached
        ? `detached @ ${headOid === null ? "?" : shortOid(headOid).slice(0, 7)}`
        : (head.branch ?? "No branch");

  return (
    <div className={styles["ribbon"]} role="toolbar" aria-label="Repository actions">
      <div className={styles["group"]} role="group" aria-label="Navigate">
        <button
          type="button"
          className={styles["dropdown"]}
          aria-haspopup="menu"
          aria-label="Repository"
          title="Switch repository"
          onClick={open("repo")}
        >
          <FolderGit2 size={ICON} aria-hidden="true" />
          <span className={styles["dropdownText"]}>{repoName}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        <span className={styles["sep"]} aria-hidden="true">
          <ChevronRight size={14} />
        </span>
        <button
          type="button"
          className={styles["dropdown"]}
          aria-haspopup="dialog"
          aria-label="Branch picker"
          title="Switch branch"
          onClick={(e) => setBranchAnchor(anchorOf(e.currentTarget))}
        >
          <GitBranch size={ICON} aria-hidden="true" />
          <span className={styles["dropdownText"]}>{branchLabel}</span>
          {upstream !== null && (upstream.ahead > 0 || upstream.behind > 0) && (
            <span className={styles["sync"]}>{syncText(upstream.ahead, upstream.behind)}</span>
          )}
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>

      <div className={`${styles["group"]} ${styles["centre"]}`} role="group" aria-label="Actions">
        <RibbonButton
          icon={Undo2}
          label="Undo"
          disabled={undo === null || busy || inProgress}
          title={
            undo === null
              ? "Nothing to undo"
              : inProgress
                ? opBlocked
                : `${undo.label}\n${undoCommand(undo)}\n(Ctrl+Z)`
          }
          onClick={() => undo !== null && void undoLast(repoId, undo)}
        />
        <RibbonButton
          icon={Redo2}
          label="Redo"
          disabled={redo === null || busy || inProgress}
          title={redo === null ? "Nothing to redo" : inProgress ? opBlocked : "Redo (Ctrl+Y)"}
          onClick={() => void redoLast(repoId)}
        />
        <div className={styles["split"]}>
          <RibbonButton
            icon={Download}
            label="Fetch"
            disabled={busy || !hasRemotes}
            title={hasRemotes ? "Fetch all remotes (Ctrl+Shift+F)" : noRemotes}
            onClick={() => void fetchAll(repoId, FETCH_ALL)}
          />
          <button
            type="button"
            className={styles["caret"]}
            aria-label="Fetch options"
            aria-haspopup="menu"
            title="Fetch and pull options"
            onClick={open("fetch")}
          >
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </div>
        <RibbonButton
          icon={Upload}
          label="Push"
          disabled={busy || !hasRemotes}
          title={hasRemotes ? `Push${ahead > 0 ? ` (↑${ahead})` : ""} (Ctrl+Shift+P)` : noRemotes}
          onClick={() => openPush(repoId)}
        />
        <RibbonButton
          icon={GitBranchPlus}
          label="Branch"
          title="Create branch at HEAD"
          disabled={headOid === null}
          onClick={() => headOid !== null && openCreateBranch(repoId, headOid, "HEAD")}
        />
        <RibbonButton
          icon={Archive}
          label="Stash"
          title={clean ? "No changes to stash" : "Stash changes"}
          disabled={clean}
          onClick={() => openStashPush(repoId)}
        />
        <RibbonButton
          icon={ArchiveRestore}
          label="Pop"
          title={stashCount === 0 ? "No stashes" : "Pop the latest stash"}
          disabled={busy || stashCount === 0}
          onClick={() => {
            const latest = stashes?.[0];
            if (latest !== undefined) void stashPop(repoId, latest);
          }}
        />
        <RibbonButton
          icon={SquareTerminal}
          label="Terminal"
          title="Open a terminal in this repository"
          onClick={() =>
            void openTerminal(repoId).catch((e: unknown) =>
              reportError(e, "Could not open the terminal"),
            )
          }
        />
      </div>

      <div className={styles["group"]} role="group" aria-label="More">
        <button
          type="button"
          className={styles["button"]}
          aria-label="More actions"
          aria-haspopup="menu"
          title="More actions"
          onClick={open("actions")}
        >
          <Ellipsis size={ICON} aria-hidden="true" />
          <span className={styles["label"]}>More</span>
        </button>
        <RibbonButton
          icon={Search}
          label="Search"
          title="Filter commits (Ctrl+F)"
          onClick={() => useGraphStore.getState().openFilterBar(repoId)}
        />
      </div>

      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.kind)}
          onClose={() => setMenu(null)}
        />
      )}
      {branchAnchor !== null && (
        <BranchPicker repoId={repoId} anchor={branchAnchor} onClose={() => setBranchAnchor(null)} />
      )}
      {stashAnchor !== null && (
        <Popover
          x={stashAnchor.x}
          y={stashAnchor.y}
          align="right"
          label="Stashes"
          onClose={() => setStashAnchor(null)}
        >
          <StashList repoId={repoId} onShown={() => setStashAnchor(null)} />
        </Popover>
      )}
    </div>
  );
}
