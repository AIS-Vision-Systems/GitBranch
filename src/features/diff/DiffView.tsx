import { memo, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { DiffLine, FileDiff } from "../../ipc/commit";
import type { DiffViewMode } from "../../state/details";
import { highlight, langFor, type Lang } from "./highlight";
import { buildRows, type DiffRow } from "./buildRows";
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

function Side({
  line,
  side,
  lang,
}: {
  line: DiffLine | null;
  side: "old" | "new";
  lang: Lang | null;
}) {
  const no = line === null ? null : side === "old" ? line.oldNo : line.newNo;
  const cls = line === null ? "empty" : LINE_CLASS[line.kind];
  return (
    <>
      <span role="cell" className={`${styles["gutter"]} ${styles[cls] ?? ""}`}>
        {no ?? ""}
      </span>
      <span role="cell" className={`${styles["code"]} ${styles[cls] ?? ""}`}>
        {line !== null && <Code text={line.text} lang={lang} />}
      </span>
    </>
  );
}

const RowView = memo(function RowView({ row, lang }: { row: DiffRow; lang: Lang | null }) {
  switch (row.type) {
    case "hunk":
      return (
        <div role="row" className={`${styles["row"]} ${styles["hunkRow"]}`}>
          <span role="cell" className={styles["hunkText"]}>
            {row.header}
          </span>
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
      return (
        <div role="row" className={`${styles["row"]} ${styles["unified"]}`}>
          <span role="cell" className={`${styles["gutter"]} ${styles[cls] ?? ""}`}>
            {l.oldNo ?? ""}
          </span>
          <span role="cell" className={`${styles["gutter"]} ${styles[cls] ?? ""}`}>
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
      return (
        <div role="row" className={`${styles["row"]} ${styles["split"]}`}>
          <Side line={row.left} side="old" lang={lang} />
          <Side line={row.right} side="new" lang={lang} />
        </div>
      );
  }
});

function Rows({ rows, lang }: { rows: DiffRow[]; lang: Lang | null }) {
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
                <RowView row={rows[v.index]!} lang={lang} />
              </div>
            ))
          : rows.map((r) => <RowView key={r.key} row={r} lang={lang} />)}
      </div>
    </div>
  );
}

export interface DiffViewProps {
  diff: FileDiff | null;
  loading: boolean;
  label: string;
  view: DiffViewMode;
  onViewChange: (v: DiffViewMode) => void;
}

export function DiffView({ diff, loading, label, view, onViewChange }: DiffViewProps) {
  const rows = useMemo(() => (diff === null ? [] : buildRows(diff, view)), [diff, view]);
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
        <span className={styles["label"]} title={label}>
          {label}
        </span>
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
      {!loading && diff !== null && notice === null && <Rows rows={rows} lang={lang} />}
    </section>
  );
}
