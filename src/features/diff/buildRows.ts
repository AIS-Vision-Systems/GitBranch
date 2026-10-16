import type { DiffLine, FileDiff } from "../../ipc/commit";
import type { DiffViewMode } from "../../state/details";
import { pairHunk } from "./pairHunk";

export type DiffRow =
  | { type: "hunk"; key: string; header: string }
  | { type: "line"; key: string; line: DiffLine }
  | { type: "split"; key: string; left: DiffLine | null; right: DiffLine | null }
  | { type: "nonl"; key: string };

export function buildRows(diff: FileDiff, view: DiffViewMode): DiffRow[] {
  const rows: DiffRow[] = [];
  diff.hunks.forEach((h, hi) => {
    rows.push({ type: "hunk", key: `h${hi}`, header: h.header });
    if (view === "unified") {
      h.lines.forEach((line, li) => {
        rows.push({ type: "line", key: `h${hi}l${li}`, line });
        if (line.noNewline) rows.push({ type: "nonl", key: `h${hi}l${li}n` });
      });
    } else {
      pairHunk(h).forEach((p, pi) => {
        rows.push({ type: "split", key: `h${hi}p${pi}`, left: p.left, right: p.right });
        if (p.left?.noNewline === true || p.right?.noNewline === true) {
          rows.push({ type: "nonl", key: `h${hi}p${pi}n` });
        }
      });
    }
  });
  return rows;
}
