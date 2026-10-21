import type { DiffRow } from "./buildRows";

export type MarkKind = "added" | "deleted";

export interface OverviewMark {
  /** 0..1 of the total row count. */
  top: number;
  height: number;
  kind: MarkKind;
  /** Deletions (red) sit on the left half of the ruler, additions (green) on the right. */
  side: "left" | "right";
}

/** [hasDel, hasAdd] for a row, or null when the row is not a change. */
function changeOf(row: DiffRow): [boolean, boolean] | null {
  if (row.type === "line") {
    if (row.line.kind === "context") return null;
    return [row.line.kind === "del", row.line.kind === "add"];
  }
  if (row.type === "split") {
    const del = row.left !== null && row.left.kind === "del";
    const add = row.right !== null && row.right.kind === "add";
    return del || add ? [del, add] : null;
  }
  return null;
}

/** One red-left mark for each run with deletions and one green-right mark for each run with additions (a modification yields both). */
export function overviewMarks(rows: readonly DiffRow[]): OverviewMark[] {
  const marks: OverviewMark[] = [];
  const n = rows.length;
  if (n === 0) return marks;
  let start = -1;
  let del = false;
  let add = false;
  const flush = (end: number): void => {
    if (start < 0) return;
    const top = start / n;
    const height = (end - start) / n;
    if (del) marks.push({ top, height, kind: "deleted", side: "left" });
    if (add) marks.push({ top, height, kind: "added", side: "right" });
    start = -1;
    del = false;
    add = false;
  };
  rows.forEach((r, i) => {
    const c = changeOf(r);
    if (c === null) {
      flush(i);
      return;
    }
    if (start < 0) start = i;
    del ||= c[0];
    add ||= c[1];
  });
  flush(n);
  return marks;
}
