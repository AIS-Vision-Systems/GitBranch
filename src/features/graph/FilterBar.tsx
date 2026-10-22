import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { RepoId } from "../../ipc/types";
import { filterActive, NO_FILTER, useGraphStore, type GraphFilter } from "../../state/graph";
import styles from "./FilterBar.module.css";

const DEBOUNCE_MS = 250;

interface Props {
  repoId: RepoId;
}

export function FilterBar({ repoId }: Props) {
  const setFilter = useGraphStore((s) => s.setFilter);
  const closeFilterBar = useGraphStore((s) => s.closeFilterBar);
  const tick = useGraphStore((s) => s.filterFocusTick);
  const applied = useGraphStore((s) => s.filters[repoId]);
  const matches = useGraphStore((s) => s.byRepo[repoId]?.commits.length ?? 0);
  const hasMore = useGraphStore((s) => s.byRepo[repoId]?.hasMore ?? false);
  const error = useGraphStore((s) => s.filterError[repoId]);
  const [draft, setDraft] = useState<GraphFilter>(applied ?? NO_FILTER);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    first.current?.select();
  }, [tick]);

  // Last filter this component pushed to the store; differences from it come from outside.
  const lastPushed = useRef<GraphFilter>(applied ?? NO_FILTER);

  useEffect(() => {
    const store = applied ?? NO_FILTER;
    const prev = lastPushed.current;
    if (
      store.author === prev.author &&
      store.message === prev.message &&
      store.path === prev.path
    ) {
      return;
    }
    lastPushed.current = store;
    setDraft(store);
  }, [applied]);

  useEffect(() => {
    const t = setTimeout(() => {
      lastPushed.current = draft;
      void setFilter(repoId, draft);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft, repoId, setFilter]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    closeFilterBar(repoId);
  };

  const field = (key: keyof GraphFilter, label: string, ref?: typeof first) => (
    <input
      ref={ref}
      className={styles["input"]}
      aria-label={label}
      placeholder={label}
      value={draft[key]}
      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
    />
  );

  const active = filterActive(applied);
  return (
    <div className={styles["bar"]} role="search" onKeyDown={onKeyDown}>
      {field("author", "Author", first)}
      {field("message", "Message")}
      {field("path", "Path")}
      {error !== undefined && (
        <span className={styles["error"]} role="alert" title={error}>
          Filter failed: {error}
        </span>
      )}
      <span className={active ? `${styles["count"]} ${styles["active"]}` : styles["count"]}>
        {active ? `${matches}${hasMore ? "+" : ""} commits match` : "No filter"}
      </span>
    </div>
  );
}
