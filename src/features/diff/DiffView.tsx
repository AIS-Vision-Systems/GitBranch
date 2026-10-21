import {
  memo,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { DiffLine, DiffTarget, FileDiff } from "../../ipc/commit";
import type { HunkSelection, PatchOp } from "../../ipc/stage";
import { confirm } from "../../state/dialogs";
import { useWipStore } from "../../state/wip";
import type { DiffViewMode } from "../../state/details";
import { highlight, langFor, type Lang } from "./highlight";
import { buildRows, hunkPatch, type DiffRow } from "./buildRows";
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
    case "split": {
      const side = (l: DiffLine | null, i: number | null): ((shift: boolean) => void) | null =>
        handlers.kind !== null && isChange(l) && i !== null
          ? (shift) => handlers.toggle(row.hunkIndex, [i], shift)
          : null;
      const onLeft = side(row.left, row.leftIndex);
      const onRight = side(row.right, row.rightIndex);
      const leftSel = onLeft !== null && row.leftIndex !== null && sel?.has(row.leftIndex) === true;
      const rightSel =
        onRight !== null && row.rightIndex !== null && sel?.has(row.rightIndex) === true;
      const selectable = onLeft !== null || onRight !== null;
      return (
        <div
          role="row"
          className={`${styles["row"]} ${styles["split"]}`}
          aria-selected={selectable ? leftSel || rightSel : undefined}
        >
          <Side line={row.left} side="old" lang={lang} selected={leftSel} onGutter={onLeft} />
          <Side line={row.right} side="new" lang={lang} selected={rightSel} onGutter={onRight} />
        </div>
      );
    }
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

function Rows({
  rows,
  lang,
  selection,
  handlers,
}: {
  rows: DiffRow[];
  lang: Lang | null;
  selection: Selection | null;
  handlers: RowHandlers;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = rows.length > VIRTUALIZE_ABOVE;
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LINE_H,
    overscan: 20,
  });
  return (
    <div ref={scrollRef} className={styles["scroll"]}>
      <div
        role="table"
        aria-label="Diff"
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
                <RowView
                  row={rows[v.index]!}
                  lang={lang}
                  sel={rowSel(rows[v.index]!, selection)}
                  handlers={handlers}
                />
              </div>
            ))
          : rows.map((r) => (
              <RowView
                key={r.key}
                row={r}
                lang={lang}
                sel={rowSel(r, selection)}
                handlers={handlers}
              />
            ))}
      </div>
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
      </div>
      {loading && <p className={styles["state"]}>Loading diff…</p>}
      {!loading && diff !== null && notice !== null && <p className={styles["state"]}>{notice}</p>}
      {!loading && diff !== null && notice === null && (
        <Rows rows={rows} lang={lang} selection={selection} handlers={handlers} />
      )}
    </section>
  );
}
