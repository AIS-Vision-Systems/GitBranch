import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import type { RepoId } from "../../ipc/types";
import { EMPTY_GRAPH, refsByOid, useGraphStore, WIP_OID } from "../../state/graph";
import { ROW_H } from "./constants";
import { rowDomId } from "./domId";
import { GraphRow } from "./GraphRow";
import { laneCount } from "./lanePaths";
import { WipRow } from "./WipRow";
import styles from "./Graph.module.css";

const LOAD_MORE_THRESHOLD = 200;
const NO_REFS: never[] = [];

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

  useEffect(() => {
    if (useGraphStore.getState().byRepo[repoId] === undefined) void load(repoId);
  }, [repoId, load]);

  const { rows, commits, refs, status, byOid, hasMore } = g ?? EMPTY_GRAPH;
  const refMap = useMemo(() => refsByOid(refs), [refs]);
  const lanes = useMemo(() => laneCount(rows), [rows]);
  const headOid = refs?.head.oid ?? null;
  const fileCount = status?.entries.length ?? 0;
  const hasWip = fileCount > 0;
  const offset = hasWip ? 1 : 0;
  const count = rows.length + offset;

  const headRow = headOid !== null ? byOid.get(headOid) : undefined;
  const wipRow = headRow !== undefined ? rows[headRow] : undefined;

  // TanStack Virtual returns unmemoizable functions; React Compiler skips this component, which is fine.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
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
      default:
        return;
    }
    e.preventDefault();
  };

  const onSelect = useCallback((oid: string) => select(oid), [select]);
  const onHover = useCallback((oid: string | null) => setHover(oid), [setHover]);

  const active = selectedOid !== null && indexOfOid(selectedOid) >= 0 ? selectedOid : undefined;

  return (
    <div
      ref={scrollRef}
      className={styles["root"]}
      role="listbox"
      aria-label="Commit graph"
      tabIndex={0}
      aria-activedescendant={active !== undefined ? rowDomId(active) : undefined}
      onKeyDown={onKeyDown}
    >
      <div className={styles["canvas"]} style={{ height: virtualizer.getTotalSize() }}>
        {items.map((v) => {
          if (hasWip && v.index === 0) {
            return (
              <WipRow
                key={WIP_OID}
                fileCount={fileCount}
                lane={wipRow?.lane ?? 0}
                color={wipRow?.color ?? 0}
                lanes={lanes}
                connected={headRow === 0}
                top={v.start}
                selected={selectedOid === WIP_OID}
                hovered={hoverOid === WIP_OID}
                onSelect={onSelect}
                onHover={onHover}
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
              commit={commit}
              refs={refMap.get(row.oid) ?? NO_REFS}
              lanes={lanes}
              top={v.start}
              selected={selectedOid === row.oid}
              hovered={hoverOid === row.oid}
              isHead={row.oid === headOid}
              wipAbove={hasWip && headRow === 0 && i === 0}
              onSelect={onSelect}
              onHover={onHover}
            />
          );
        })}
      </div>
    </div>
  );
}
