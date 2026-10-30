import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import type { Ref, RepoId } from "../../ipc/types";
import { firstRowOid } from "../../lib/firstRow";
import { pullsOf, usePullsStore } from "../../state/pulls";
import { EMPTY_GRAPH, filterActive, refsByOid, useGraphStore, WIP_OID } from "../../state/graph";
import { shortOid } from "../../state/ops";
import { useReposStore } from "../../state/repos";
import { useWorktreesStore, worktreesOf } from "../../state/worktrees";
import { installDragCleanup } from "./dnd";
import { openBranchDrop } from "../dialogs/open";
import { ContextMenu } from "../shell/ContextMenu";
import { useContextMenu } from "../shell/useContextMenu";
import { HEADER_H, LANE_W, ROW_H } from "./constants";
import { rowDomId } from "./domId";
import { FilterBar } from "./FilterBar";
import { GraphRow } from "./GraphRow";
import { laneCount } from "./lanePaths";
import { commitMenu, refMenu, remoteTrackingName, stashMenu, wipMenu } from "./menus";
import { WipRow } from "./WipRow";
import { wipPlacement } from "./wipLane";
import { worktreeMarksByOid, type WorktreeMark } from "./worktreeMarks";
import styles from "./Graph.module.css";

const LOAD_MORE_THRESHOLD = 200;
const NO_REFS: never[] = [];
const NO_MARKS: readonly WorktreeMark[] = [];

type MenuData =
  { kind: "commit"; oid: string } | { kind: "ref"; oid: string; ref: Ref } | { kind: "wip" };

interface Props {
  repoId: RepoId;
}

export function GraphView({ repoId }: Props) {
  const g = useGraphStore((s) => s.byRepo[repoId]);
  const selectedOid = useGraphStore((s) => s.selectedOid);
  const hoverOid = useGraphStore((s) => s.hoverOid);
  const load = useGraphStore((s) => s.load);
  const loadMore = useGraphStore((s) => s.loadMore);
  const select = useGraphStore((s) => s.select);
  const setHover = useGraphStore((s) => s.setHover);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ctxMenu = useContextMenu<MenuData>();
  const openMenu = ctxMenu.open;
  const [expandedOid, setExpandedOid] = useState<string | null>(null);

  useEffect(() => {
    if (expandedOid === null) return;
    const onDown = (e: globalThis.MouseEvent): void => {
      const t = e.target;
      if (t instanceof Element && t.closest("[data-refs-overlay]") !== null) return;
      setExpandedOid(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [expandedOid]);

  useEffect(() => {
    if (useGraphStore.getState().byRepo[repoId] === undefined) void load(repoId);
  }, [repoId, load]);

  useEffect(() => installDragCleanup(), []);

  const { rows, commits, refs, status, byOid, hasMore, inProgress: op, stashes } = g ?? EMPTY_GRAPH;
  const inProgress = op !== null;
  const worktrees = useWorktreesStore((s) => worktreesOf(s, repoId));
  const ownPath = useReposStore((s) => s.open.find((r) => r.repoId === repoId)?.path ?? null);
  const worktreeMarks = useMemo(() => worktreeMarksByOid(worktrees, ownPath), [worktrees, ownPath]);
  const refMap = useMemo(() => refsByOid(refs), [refs]);
  const lanes = useMemo(() => laneCount(rows), [rows]);
  const headOid = refs?.head.oid ?? null;
  const fileCount = status?.entries.length ?? 0;
  const filterBarOpen = useGraphStore(
    (s) => s.filterBarOpen[repoId] === true || filterActive(s.filters[repoId]),
  );
  const filtering = useGraphStore((s) => filterActive(s.filters[repoId]));
  // The working-tree row is not a commit, so it never matches a commit filter.
  const hasWip = fileCount > 0 && !filtering;
  const offset = hasWip ? 1 : 0;
  const count = rows.length + offset;

  const prSelected = usePullsStore((s) => pullsOf(s, repoId).selected !== null);
  const loaded = g !== undefined && !g.loading && g.refs !== null && g.status !== null;
  useEffect(() => {
    if (!loaded || prSelected || selectedOid !== null) return;
    const first = firstRowOid(hasWip, commits);
    if (first !== null) select(first);
  }, [loaded, prSelected, selectedOid, hasWip, commits, select]);

  const headRow = headOid !== null ? byOid.get(headOid) : undefined;
  // The WIP connector runs down to HEAD: on HEAD's lane when HEAD is on top, otherwise on a free lane
  // beside the rows above it, bending into HEAD's node.
  const wip = useMemo(() => wipPlacement(rows, commits, headRow), [rows, commits, headRow]);
  const wipThroughLane = hasWip ? wip.throughLane : null;
  const wipColor = wip.color;
  const wipThrough = useMemo(
    () => (wipThroughLane !== null ? { lane: wipThroughLane, color: wipColor } : undefined),
    [wipThroughLane, wipColor],
  );
  const lanesShown = hasWip ? Math.max(lanes, wip.lane + 1) : lanes;

  // TanStack Virtual returns unmemoizable functions; React Compiler skips this component, which is fine.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
    scrollPaddingStart: HEADER_H,
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.length > 0 ? items[items.length - 1]!.index : -1;

  useEffect(() => {
    if (hasMore && lastIndex >= count - LOAD_MORE_THRESHOLD) void loadMore(repoId);
  }, [hasMore, lastIndex, count, repoId, loadMore]);

  const indexOfOid = useCallback(
    (oid: string | null): number => {
      if (oid === null) return -1;
      if (oid === WIP_OID) return hasWip ? 0 : -1;
      const i = byOid.get(oid);
      return i === undefined ? -1 : i + offset;
    },
    [byOid, hasWip, offset],
  );

  const oidAt = useCallback(
    (i: number): string | null => {
      if (hasWip && i === 0) return WIP_OID;
      return rows[i - offset]?.oid ?? null;
    },
    [rows, hasWip, offset],
  );

  const goTo = useCallback(
    (i: number): void => {
      if (count === 0) return;
      const clamped = Math.max(0, Math.min(count - 1, i));
      const oid = oidAt(clamped);
      if (oid === null) return;
      select(oid);
      virtualizer.scrollToIndex(clamped);
    },
    [count, oidAt, select, virtualizer],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if ((e.key === "PageUp" || e.key === "PageDown") && (e.ctrlKey || e.metaKey)) return;
    const cur = indexOfOid(selectedOid);
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 0) / ROW_H) - 1);
    switch (e.key) {
      case "ArrowDown":
        goTo(cur < 0 ? 0 : cur + 1);
        break;
      case "ArrowUp":
        goTo(cur < 0 ? 0 : cur - 1);
        break;
      case "PageDown":
        goTo(cur < 0 ? 0 : cur + page);
        break;
      case "PageUp":
        goTo(cur < 0 ? 0 : cur - page);
        break;
      case "Home":
        goTo(0);
        break;
      case "End":
        goTo(count - 1);
        break;
      case "ContextMenu":
      case "F10": {
        if (e.key === "F10" && !e.shiftKey) return;
        const el = scrollRef.current;
        if (cur < 0 || el === null || oidAt(cur) === WIP_OID) return;
        const oid = oidAt(cur);
        if (oid === null) return;
        const rect = el.getBoundingClientRect();
        const y = rect.top + HEADER_H + cur * ROW_H - el.scrollTop + ROW_H;
        // Keyboard has no pointer event; the menu only needs a position.
        const at = { clientX: rect.left + 48, clientY: y, preventDefault: () => undefined };
        openMenu(at as unknown as MouseEvent, { kind: "commit", oid });
        break;
      }
      case "Escape":
        if (expandedOid === null) return;
        setExpandedOid(null);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const onSelect = useCallback((oid: string) => select(oid), [select]);
  const onExpand = useCallback((oid: string) => setExpandedOid(oid), []);
  const onHover = useCallback((oid: string | null) => setHover(oid), [setHover]);

  const onRowMenu = useCallback(
    (e: MouseEvent, oid: string) => {
      select(oid);
      openMenu(e, { kind: "commit", oid });
    },
    [select, openMenu],
  );
  const onRefMenu = useCallback(
    (e: MouseEvent, ref: Ref) => {
      select(ref.target);
      openMenu(e, { kind: "ref", oid: ref.target, ref });
    },
    [select, openMenu],
  );

  const onWipMenu = useCallback(
    (e: MouseEvent) => {
      select(WIP_OID);
      openMenu(e, { kind: "wip" });
    },
    [select, openMenu],
  );

  const onRowDrop = useCallback(
    (source: string, oid: string) => {
      const own = refMap.get(oid)?.some((r) => r.kind === "localBranch" && r.name === source);
      if (own === true) return;
      openBranchDrop(repoId, source, oid, shortOid(oid), "commit");
    },
    [repoId, refMap],
  );
  const onRefDrop = useCallback(
    (source: string, ref: Ref) => {
      const name = ref.kind === "localBranch" ? ref.name : remoteTrackingName(ref);
      if (name === source) return;
      const kind =
        ref.kind === "localBranch"
          ? "local"
          : typeof ref.kind === "object" && "remoteBranch" in ref.kind
            ? "remote"
            : "commit";
      openBranchDrop(repoId, source, name, name, kind);
    },
    [repoId],
  );

  const menuItems = (() => {
    const data = ctxMenu.menu?.data;
    if (data === undefined) return null;
    if (data.kind === "wip") return wipMenu(repoId, status?.entries ?? [], inProgress);
    const i = byOid.get(data.oid);
    const commit = i === undefined ? undefined : commits[i];
    if (commit === undefined) return null;
    if (commit.stash) {
      // The store's own stash_list runs beside load_graph; a stash the cache drew but the store
      // has not seen yet (or no longer lists) just has no menu.
      const entry = stashes.find((s) => s.oid === commit.oid);
      return entry === undefined ? null : stashMenu(repoId, entry, inProgress);
    }
    const ctx = {
      repoId,
      commit,
      refs: refMap.get(data.oid) ?? [],
      head: refs?.head ?? null,
      inProgress,
    };
    return data.kind === "commit" ? commitMenu(ctx) : refMenu(ctx, data.ref);
  })();

  const active = selectedOid !== null && indexOfOid(selectedOid) >= 0 ? selectedOid : undefined;

  return (
    <div className={styles["pane"]}>
      {filterBarOpen && <FilterBar repoId={repoId} />}
      <div
        ref={scrollRef}
        className={styles["root"]}
        role="listbox"
        aria-label="Commit graph"
        tabIndex={0}
        aria-activedescendant={active !== undefined ? rowDomId(active) : undefined}
        onKeyDown={onKeyDown}
      >
        <div className={styles["header"]} aria-hidden="true">
          <span className={styles["refsHead"]}>Branch / Tag</span>
          <span className={styles["graphHead"]} style={{ width: lanesShown * LANE_W }}>
            Graph
          </span>
          <span className={styles["messageHead"]}>Commit message</span>
        </div>
        <div className={styles["canvas"]} style={{ height: virtualizer.getTotalSize() }}>
          {items.map((v) => {
            if (hasWip && v.index === 0) {
              return (
                <WipRow
                  key={WIP_OID}
                  fileCount={fileCount}
                  lane={wip.lane}
                  color={wip.color}
                  lanes={lanesShown}
                  connected={wip.connected}
                  top={v.start}
                  selected={selectedOid === WIP_OID}
                  hovered={hoverOid === WIP_OID}
                  onSelect={onSelect}
                  onHover={onHover}
                  onContextMenu={onWipMenu}
                />
              );
            }
            const i = v.index - offset;
            const row = rows[i];
            const commit = commits[i];
            if (row === undefined || commit === undefined) return null;
            return (
              <GraphRow
                key={row.oid}
                row={row}
                repoId={repoId}
                commit={commit}
                refs={refMap.get(row.oid) ?? NO_REFS}
                worktrees={worktreeMarks.get(row.oid) ?? NO_MARKS}
                lanes={lanesShown}
                top={v.start}
                selected={selectedOid === row.oid}
                hovered={hoverOid === row.oid}
                isHead={row.oid === headOid}
                wipAbove={hasWip && wip.connected && !wip.joinsFromSide && i === headRow}
                {...(wipThrough !== undefined && headRow !== undefined && i < headRow
                  ? { wipThrough }
                  : {})}
                {...(wipThrough !== undefined && wip.joinsFromSide && i === headRow
                  ? { wipJoin: wipThrough }
                  : {})}
                expanded={expandedOid === row.oid}
                onExpand={onExpand}
                onSelect={onSelect}
                onHover={onHover}
                onContextMenu={onRowMenu}
                onRefContextMenu={onRefMenu}
                onRowDrop={onRowDrop}
                onRefDrop={onRefDrop}
              />
            );
          })}
        </div>
      </div>
      {ctxMenu.menu !== null && menuItems !== null && (
        <ContextMenu
          x={ctxMenu.menu.x}
          y={ctxMenu.menu.y}
          items={menuItems}
          onClose={ctxMenu.close}
        />
      )}
    </div>
  );
}
