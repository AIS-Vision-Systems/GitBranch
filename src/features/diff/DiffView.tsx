import {
  Fragment,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import type { DiffLine, DiffTarget, FileDiff } from "../../ipc/commit";
import type { HunkSelection, PatchOp } from "../../ipc/stage";
import { confirm } from "../../state/dialogs";
import { useWipStore } from "../../state/wip";
import type { DiffViewMode } from "../../state/details";
import { highlight, langFor, type Lang } from "./highlight";
import { buildRows, hunkPatch, type DiffRow } from "./buildRows";
import { overviewMarks } from "./overview";
import { loadWrap, WRAP_BELOW, WRAP_KEY } from "./wrap";
import styles from "./Diff.module.css";

/** Keep in sync with `--diff-line-h`. */
export const LINE_H = 20;
export const VIRTUALIZE_ABOVE = 2000;

const MARKER: Record<DiffLine["kind"], string> = { context: " ", add: "+", del: "-" };
const LINE_CLASS: Record<DiffLine["kind"], string> = {
  context: "",
  add: "add",
  del: "del",
};

function Code({ text, lang }: { text: string; lang: Lang | null }) {
  const tokens = useMemo(() => highlight(text, lang), [text, lang]);
  return (
    <>
      {tokens.map((t, i) =>
        t.cls === null ? (
          <span key={i}>{t.text}</span>
        ) : (
          <span key={i} className={styles[t.cls]}>
            {t.text}
          </span>
        ),
      )}
    </>
  );
}

function gutterClass(cls: string, selected: boolean, clickable: boolean): string {
  return [
    styles["gutter"],
    styles[cls] ?? "",
    clickable ? styles["gutterClickable"] : "",
    selected ? styles["lineSelected"] : "",
  ].join(" ");
}

function isChange(l: DiffLine | null): l is DiffLine {
  return l !== null && l.kind !== "context";
}

/** Space toggles the focused changed line; Shift+Space extends the selection. */
function spaceToggle(
  onToggle: (shift: boolean) => void,
): (e: ReactKeyboardEvent<HTMLElement>) => void {
  return (e) => {
    if (e.key !== " " || e.target !== e.currentTarget) return;
    e.preventDefault();
    onToggle(e.shiftKey);
  };
}

export interface RowHandlers {
  /** A hunk operation is running; action buttons are disabled. */
  busy: boolean;
  /** null when line staging does not apply (commit view, untracked). */
  kind: "staged" | "unstaged" | null;
  toggle: (hunkIndex: number, lineIndices: number[], shift: boolean) => void;
  op: (hunkIndex: number, op: PatchOp) => void;
}

function HunkActions({
  hunkIndex,
  count,
  handlers,
}: {
  hunkIndex: number;
  count: number;
  handlers: RowHandlers;
}) {
  const what = count === 0 ? "hunk" : `${count} ${count === 1 ? "line" : "lines"}`;
  const btn = (label: string, op: PatchOp, danger = false) => (
    <button
      type="button"
      className={danger ? `${styles["hunkBtn"]} ${styles["hunkBtnDanger"]}` : styles["hunkBtn"]}
      disabled={handlers.busy}
      onClick={() => handlers.op(hunkIndex, op)}
    >
      {label} {what}
    </button>
  );
  return (
    <span className={styles["hunkActions"]}>
      {handlers.kind === "staged" ? (
        btn("Unstage", "unstage")
      ) : (
        <>
          {btn("Stage", "stage")}
          {btn("Discard", "discard", true)}
        </>
      )}
    </span>
  );
}

function Side({
  line,
  side,
  lang,
  selected,
  onGutter,
}: {
  line: DiffLine | null;
  side: "old" | "new";
  lang: Lang | null;
  selected: boolean;
  /** null when this side's line is not selectable. */
  onGutter: ((shift: boolean) => void) | null;
}) {
  const no = line === null ? null : side === "old" ? line.oldNo : line.newNo;
  const cls = line === null ? "empty" : LINE_CLASS[line.kind];
  return (
    <>
      <span
        role="cell"
        className={gutterClass(cls, selected, onGutter !== null)}
        tabIndex={onGutter === null ? undefined : 0}
        onClick={onGutter === null ? undefined : (e) => onGutter(e.shiftKey)}
        onKeyDown={onGutter === null ? undefined : spaceToggle(onGutter)}
      >
        {no ?? ""}
      </span>
      <span role="cell" className={`${styles["code"]} ${styles[cls] ?? ""}`}>
        {line !== null && <Code text={line.text} lang={lang} />}
      </span>
    </>
  );
}

const RowView = memo(function RowView({
  row,
  lang,
  sel,
  handlers,
}: {
  row: DiffRow;
  lang: Lang | null;
  /** Selected line indices when this row's hunk holds the selection, else null. */
  sel: ReadonlySet<number> | null;
  handlers: RowHandlers;
}) {
  switch (row.type) {
    case "hunk":
      return (
        <div role="row" className={`${styles["row"]} ${styles["hunkRow"]}`}>
          <span role="cell" className={styles["hunkText"]}>
            {row.header}
          </span>
          {handlers.kind !== null && (
            <HunkActions hunkIndex={row.hunkIndex} count={sel?.size ?? 0} handlers={handlers} />
          )}
        </div>
      );
    case "nonl":
      return (
        <div role="row" className={`${styles["row"]} ${styles["nonlRow"]}`}>
          <span role="cell" className={styles["nonlText"]}>
            ↵ No newline at end of file
          </span>
        </div>
      );
    case "line": {
      const l = row.line;
      const cls = LINE_CLASS[l.kind];
      const selectable = handlers.kind !== null && isChange(l);
      const selected = selectable && sel?.has(row.lineIndex) === true;
      const onGutter = selectable
        ? (e: { shiftKey: boolean }) => handlers.toggle(row.hunkIndex, [row.lineIndex], e.shiftKey)
        : undefined;
      return (
        <div
          role="row"
          className={`${styles["row"]} ${styles["unified"]}`}
          aria-selected={selectable ? selected : undefined}
          tabIndex={selectable ? 0 : undefined}
          onKeyDown={
            onGutter === undefined
              ? undefined
              : spaceToggle((shift) => onGutter({ shiftKey: shift }))
          }
        >
          <span role="cell" className={gutterClass(cls, selected, selectable)} onClick={onGutter}>
            {l.oldNo ?? ""}
          </span>
          <span role="cell" className={gutterClass(cls, selected, selectable)} onClick={onGutter}>
            {l.newNo ?? ""}
          </span>
          <span role="cell" className={`${styles["marker"]} ${styles[cls] ?? ""}`}>
            {MARKER[l.kind]}
          </span>
          <span role="cell" className={`${styles["code"]} ${styles[cls] ?? ""}`}>
            <Code text={l.text} lang={lang} />
          </span>
        </div>
      );
    }
    case "split":
      return null;
  }
});

interface Selection {
  diff: FileDiff;
  hunk: number;
  lines: ReadonlySet<number>;
  anchor: number;
}

function rowSel(row: DiffRow, s: Selection | null): ReadonlySet<number> | null {
  if (s === null || row.type === "nonl" || row.hunkIndex !== s.hunk) return null;
  return s.lines;
}

const PaneRowView = memo(function PaneRowView({
  row,
  side,
  lang,
  sel,
  handlers,
}: {
  row: DiffRow;
  side: "old" | "new";
  lang: Lang | null;
  sel: ReadonlySet<number> | null;
  handlers: RowHandlers;
}) {
  switch (row.type) {
    case "hunk":
      return (
        <div role="row" className={`${styles["row"]} ${styles["hunkRow"]}`}>
          {side === "old" ? (
            <span role="cell" className={styles["hunkText"]}>
              {row.header}
            </span>
          ) : (
            handlers.kind !== null && (
              <HunkActions hunkIndex={row.hunkIndex} count={sel?.size ?? 0} handlers={handlers} />
            )
          )}
        </div>
      );
    case "nonl":
      return (
        <div role="row" className={`${styles["row"]} ${styles["nonlRow"]}`}>
          <span role="cell" className={styles["nonlText"]}>
            ↵ No newline at end of file
          </span>
        </div>
      );
    case "split": {
      const line = side === "old" ? row.left : row.right;
      const index = side === "old" ? row.leftIndex : row.rightIndex;
      const onGutter: ((shift: boolean) => void) | null =
        handlers.kind !== null && isChange(line) && index !== null
          ? (shift) => handlers.toggle(row.hunkIndex, [index], shift)
          : null;
      const selected = onGutter !== null && index !== null && sel?.has(index) === true;
      return (
        <div
          role="row"
          className={`${styles["row"]} ${styles["pane"]}`}
          aria-selected={onGutter !== null ? selected : undefined}
        >
          <Side line={line} side={side} lang={lang} selected={selected} onGutter={onGutter} />
        </div>
      );
    }
    case "line":
      return null;
  }
});

function Pane({
  scrollRef,
  rows,
  virtualizer,
  virtual,
  label,
  onScroll,
  render,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  rows: DiffRow[];
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  virtual: boolean;
  label: string;
  onScroll: () => void;
  render: (row: DiffRow) => ReactNode;
}) {
  return (
    <div ref={scrollRef} className={styles["scroll"]} onScroll={onScroll}>
      <div
        role="table"
        aria-label={label}
        aria-rowcount={rows.length}
        className={styles["table"]}
        style={virtual ? { height: virtualizer.getTotalSize() } : undefined}
      >
        {virtual
          ? virtualizer.getVirtualItems().map((v) => (
              <div
                key={rows[v.index]!.key}
                className={styles["virtualRow"]}
                style={{ transform: `translateY(${v.start}px)` }}
              >
                {render(rows[v.index]!)}
              </div>
            ))
          : rows.map((r) => <Fragment key={r.key}>{render(r)}</Fragment>)}
      </div>
    </div>
  );
}

interface Viewport {
  top: number;
  height: number;
}

function Ruler({
  rows,
  viewport,
  onSeek,
}: {
  rows: DiffRow[];
  viewport: Viewport;
  onSeek: (fraction: number) => void;
}) {
  const marks = useMemo(() => overviewMarks(rows), [rows]);
  return (
    <div
      className={styles["ruler"]}
      data-testid="diff-ruler"
      aria-hidden="true"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (r.height > 0) onSeek((e.clientY - r.top) / r.height);
      }}
    >
      {marks.map((m, i) => (
        <span
          key={i}
          className={`${styles["mark"]} ${styles[`mark_${m.side}`] ?? ""}`}
          style={{ top: `${m.top * 100}%`, height: `${m.height * 100}%` }}
        />
      ))}
      <span
        className={styles["rulerView"]}
        style={{
          top: `${viewport.top * 100}%`,
          height: `${viewport.height * 100}%`,
        }}
      />
    </div>
  );
}

/** Give each aligned row pair the taller of its two heights (wrapped split view). */
function alignPanes(left: HTMLElement, right: HTMLElement): void {
  const l = left.querySelectorAll<HTMLElement>("[role=table] > [role=row]");
  const r = right.querySelectorAll<HTMLElement>("[role=table] > [role=row]");
  const n = Math.min(l.length, r.length);
  for (let i = 0; i < n; i++) {
    l[i]!.style.minHeight = "";
    r[i]!.style.minHeight = "";
  }
  const heights: number[] = [];
  for (let i = 0; i < n; i++) heights.push(Math.max(l[i]!.offsetHeight, r[i]!.offsetHeight));
  for (let i = 0; i < n; i++) {
    const h = `${heights[i]}px`;
    l[i]!.style.minHeight = h;
    r[i]!.style.minHeight = h;
  }
}

function Rows({
  rows,
  view,
  wrap,
  lang,
  selection,
  handlers,
}: {
  rows: DiffRow[];
  view: DiffViewMode;
  wrap: boolean;
  lang: Lang | null;
  selection: Selection | null;
  handlers: RowHandlers;
}) {
  const split = view === "split";
  // Wrapped rows have variable height, which two independently scrolled virtual panes cannot
  // keep aligned; wrapping is therefore only applied to non-virtualized renders.
  const wrapActive = wrap && rows.length <= WRAP_BELOW;
  const virtual = rows.length > VIRTUALIZE_ABOVE && !wrapActive;
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  /** A programmatic sync scroll whose event must not be echoed back (matched by pane and position). */
  const echo = useRef<{ el: HTMLDivElement; top: number; left: number } | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ top: 0, height: 1 });

  /* eslint-disable react-hooks/incompatible-library */
  const leftV = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () => leftRef.current,
    estimateSize: () => LINE_H,
    overscan: 20,
  });
  const rightV = useVirtualizer({
    count: virtual && split ? rows.length : 0,
    getScrollElement: () => rightRef.current,
    estimateSize: () => LINE_H,
    overscan: 20,
  });
  /* eslint-enable react-hooks/incompatible-library */

  const updateViewport = useCallback(() => {
    const el = leftRef.current;
    if (el === null || el.scrollHeight <= 0) return;
    setViewport({
      top: el.scrollTop / el.scrollHeight,
      height: Math.min(1, el.clientHeight / el.scrollHeight),
    });
  }, []);

  const onScroll = (src: "left" | "right"): void => {
    const from = src === "left" ? leftRef.current : rightRef.current;
    const to = src === "left" ? rightRef.current : leftRef.current;
    if (from === null) return;
    if (
      echo.current !== null &&
      echo.current.el === from &&
      echo.current.top === from.scrollTop &&
      echo.current.left === from.scrollLeft
    ) {
      echo.current = null;
      return;
    }
    if (
      split &&
      to !== null &&
      (to.scrollTop !== from.scrollTop || to.scrollLeft !== from.scrollLeft)
    ) {
      const before = [to.scrollTop, to.scrollLeft];
      to.scrollTop = from.scrollTop;
      to.scrollLeft = from.scrollLeft;
      if (to.scrollTop !== before[0] || to.scrollLeft !== before[1]) {
        echo.current = { el: to, top: to.scrollTop, left: to.scrollLeft };
      }
    }
    updateViewport();
  };

  const seek = (fraction: number): void => {
    const el = leftRef.current;
    if (el === null) return;
    const top = Math.max(0, fraction * el.scrollHeight - el.clientHeight / 2);
    el.scrollTop = top;
    if (split && rightRef.current !== null) rightRef.current.scrollTop = top;
    updateViewport();
  };

  useLayoutEffect(() => {
    updateViewport();
  }, [rows, updateViewport]);

  const aligned = split && wrapActive;
  useLayoutEffect(() => {
    const l = leftRef.current;
    const r = rightRef.current;
    if (!aligned || l === null || r === null) return;
    alignPanes(l, r);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => alignPanes(l, r));
    ro.observe(l);
    ro.observe(r);
    return () => ro.disconnect();
  }, [aligned, rows]);

  const cls = [
    styles["panes"],
    split ? styles["panesSplit"] : "",
    wrapActive ? styles["wrap"] : "",
  ];
  return (
    <div className={styles["body"]}>
      <div className={cls.join(" ")}>
        {split ? (
          <>
            <Pane
              scrollRef={leftRef}
              rows={rows}
              virtualizer={leftV}
              virtual={virtual}
              label="Diff (old)"
              onScroll={() => onScroll("left")}
              render={(r) => (
                <PaneRowView
                  row={r}
                  side="old"
                  lang={lang}
                  sel={rowSel(r, selection)}
                  handlers={handlers}
                />
              )}
            />
            <div className={styles["divider"]} />
            <Pane
              scrollRef={rightRef}
              rows={rows}
              virtualizer={rightV}
              virtual={virtual}
              label="Diff (new)"
              onScroll={() => onScroll("right")}
              render={(r) => (
                <PaneRowView
                  row={r}
                  side="new"
                  lang={lang}
                  sel={rowSel(r, selection)}
                  handlers={handlers}
                />
              )}
            />
          </>
        ) : (
          <Pane
            scrollRef={leftRef}
            rows={rows}
            virtualizer={leftV}
            virtual={virtual}
            label="Diff"
            onScroll={() => onScroll("left")}
            render={(r) => (
              <RowView row={r} lang={lang} sel={rowSel(r, selection)} handlers={handlers} />
            )}
          />
        )}
      </div>
      <Ruler rows={rows} viewport={viewport} onSeek={seek} />
    </div>
  );
}

export interface DiffViewProps {
  diff: FileDiff | null;
  loading: boolean;
  label: string;
  /** Hide the file label in the toolbar (the host already shows it). */
  hideLabel?: boolean;
  view: DiffViewMode;
  onViewChange: (v: DiffViewMode) => void;
  /** With `onHunkOp`, enables hunk and line staging for `staged` / `unstaged` targets. */
  target?: DiffTarget;
  onHunkOp?: (sel: HunkSelection, op: PatchOp) => void | Promise<void>;
}

export function DiffView({
  diff,
  loading,
  label,
  hideLabel = false,
  view,
  onViewChange,
  target,
  onHunkOp,
}: DiffViewProps) {
  const rows = useMemo(() => (diff === null ? [] : buildRows(diff, view)), [diff, view]);
  const kind =
    target !== undefined &&
    onHunkOp !== undefined &&
    (target.kind === "staged" || target.kind === "unstaged")
      ? target.kind
      : null;
  const busy = useWipStore((s) => s.busy);
  const [wrap, setWrapState] = useState(loadWrap);
  const setWrap = (v: boolean): void => {
    setWrapState(v);
    try {
      localStorage.setItem(WRAP_KEY, String(v));
    } catch {
      // storage unavailable: keep the in-memory value
    }
  };
  const [rawSelection, setSelection] = useState<Selection | null>(null);
  // A new diff (after any op or reload) invalidates the selection.
  const selection = rawSelection !== null && rawSelection.diff === diff ? rawSelection : null;
  const latest = useRef({ diff, selection, target, onHunkOp });
  useLayoutEffect(() => {
    latest.current = { diff, selection, target, onHunkOp };
  });

  const toggle = useCallback((hunkIndex: number, idx: number[], shift: boolean) => {
    const { diff: d, selection: cur } = latest.current;
    const lines = d?.hunks[hunkIndex]?.lines;
    if (d === null || lines === undefined) return;
    const same = cur !== null && cur.hunk === hunkIndex;
    const next = new Set<number>(same ? cur.lines : []);
    let anchor = idx[0]!;
    if (shift && same) {
      anchor = cur.anchor;
      const lo = Math.min(anchor, ...idx);
      const hi = Math.max(anchor, ...idx);
      for (let i = lo; i <= hi; i++) if (lines[i]!.kind !== "context") next.add(i);
    } else if (idx.every((i) => next.has(i))) {
      for (const i of idx) next.delete(i);
    } else {
      for (const i of idx) next.add(i);
    }
    setSelection(next.size === 0 ? null : { diff: d, hunk: hunkIndex, lines: next, anchor });
  }, []);

  const op = useCallback((hunkIndex: number, patchOp: PatchOp) => {
    const { diff: d, selection: cur, target: t, onHunkOp: cb } = latest.current;
    const hunk = d?.hunks[hunkIndex];
    if (hunk === undefined || t === undefined || cb === undefined) return;
    const lines =
      cur !== null && cur.hunk === hunkIndex ? [...cur.lines].sort((a, b) => a - b) : null;
    const sel: HunkSelection = { target: t, hunkIndex, hunkHeader: hunk.header, lines };
    if (patchOp !== "discard") {
      setSelection(null);
      void cb(sel, patchOp);
      return;
    }
    const what =
      lines === null
        ? "this hunk"
        : `${lines.length} selected ${lines.length === 1 ? "line" : "lines"} of this hunk`;
    void confirm({
      title: lines === null ? "Discard hunk" : "Discard lines",
      message: `Discard ${what} (${hunk.header})? This cannot be undone.`,
      command: `git apply -R --recount\n${hunkPatch(d!, hunkIndex)}`,
      confirmLabel: "Discard",
      danger: true,
      onConfirm: async () => {
        setSelection(null);
        await cb(sel, patchOp);
      },
    });
  }, []);

  const handlers = useMemo<RowHandlers>(
    () => ({ kind, busy, toggle, op }),
    [kind, busy, toggle, op],
  );

  const hasSelection = selection !== null;
  useEffect(() => {
    if (!hasSelection) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setSelection(null);
        // Consumed: the app-level Escape (close the diff) only fires with no selection.
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hasSelection]);

  const lang = diff === null ? null : langFor(diff.newPath ?? diff.oldPath ?? label);
  const oldMode = diff?.oldMode ?? null;
  const newMode = diff?.newMode ?? null;
  const modeChange =
    oldMode !== null && newMode !== null && oldMode !== newMode
      ? `mode ${oldMode} → ${newMode}`
      : null;

  const notice =
    diff === null
      ? null
      : diff.combined === true
        ? "Conflicted file: combined diff is not shown yet (resolve conflicts in the working tree)"
        : diff.tooLarge === true
          ? "File is too large to display (> 8 MiB)"
          : diff.binary
            ? "Binary file"
            : diff.hunks.length === 0
              ? "No changes"
              : null;

  return (
    <section className={styles["diff"]} aria-label="File diff">
      <div className={styles["toolbar"]}>
        {!hideLabel && (
          <span className={styles["label"]} title={label}>
            {label}
          </span>
        )}
        {modeChange !== null && <span className={styles["mode"]}>{modeChange}</span>}
        <div role="radiogroup" aria-label="Diff view" className={styles["toggle"]}>
          {(["unified", "split"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              className={view === v ? styles["toggleOn"] : styles["toggleOff"]}
              onClick={() => onViewChange(v)}
            >
              {v === "unified" ? "Unified" : "Split"}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={wrap}
          className={`${wrap ? styles["toggleOn"] : styles["toggleOff"]} ${styles["wrapButton"]}`}
          title="Wrap long lines (off above 5000 rows)"
          onClick={() => setWrap(!wrap)}
        >
          Wrap
        </button>
      </div>
      {loading && <p className={styles["state"]}>Loading diff…</p>}
      {!loading && diff !== null && notice !== null && <p className={styles["state"]}>{notice}</p>}
      {!loading && diff !== null && notice === null && (
        <Rows
          rows={rows}
          view={view}
          wrap={wrap}
          lang={lang}
          selection={selection}
          handlers={handlers}
        />
      )}
    </section>
  );
}
