import type { DiffLine, FileDiff } from "../../ipc/commit";
import type { DiffViewMode } from "../../state/details";
import { pairHunk } from "./pairHunk";

/** `hunkIndex` indexes `diff.hunks`; line indices index `Hunk.lines`. */
const MARKER: Record<DiffLine["kind"], string> = { context: " ", add: "+", del: "-" };

export type DiffRow =
  | { type: "hunk"; key: string; header: string; hunkIndex: number }
  | { type: "line"; key: string; line: DiffLine; hunkIndex: number; lineIndex: number }
  | {
      type: "split";
      key: string;
      left: DiffLine | null;
      right: DiffLine | null;
      hunkIndex: number;
      leftIndex: number | null;
      rightIndex: number | null;
    }
  | { type: "nonl"; key: string };

export function buildRows(diff: FileDiff, view: DiffViewMode): DiffRow[] {
  const rows: DiffRow[] = [];
  diff.hunks.forEach((h, hi) => {
    rows.push({ type: "hunk", key: `h${hi}`, header: h.header, hunkIndex: hi });
    if (view === "unified") {
      h.lines.forEach((line, li) => {
        rows.push({ type: "line", key: `h${hi}l${li}`, line, hunkIndex: hi, lineIndex: li });
        if (line.noNewline) rows.push({ type: "nonl", key: `h${hi}l${li}n` });
      });
    } else {
      const index = new Map<DiffLine, number>();
      h.lines.forEach((l, li) => index.set(l, li));
      pairHunk(h).forEach((p, pi) => {
        rows.push({
          type: "split",
          key: `h${hi}p${pi}`,
          left: p.left,
          right: p.right,
          hunkIndex: hi,
          leftIndex: p.left === null ? null : (index.get(p.left) ?? null),
          rightIndex: p.right === null ? null : (index.get(p.right) ?? null),
        });
        if (p.left?.noNewline === true || p.right?.noNewline === true) {
          rows.push({ type: "nonl", key: `h${hi}p${pi}n` });
        }
      });
    }
  });
  return rows;
}

/** The unified patch of one hunk, as shown in the discard confirmation. */
export function hunkPatch(diff: FileDiff, hunkIndex: number): string {
  const hunk = diff.hunks[hunkIndex];
  if (hunk === undefined) return "";
  const out = [
    `--- ${diff.oldPath ?? "/dev/null"}`,
    `+++ ${diff.newPath ?? "/dev/null"}`,
    hunk.header,
  ];
  for (const l of hunk.lines) {
    out.push(MARKER[l.kind] + l.text);
    if (l.noNewline) out.push("\\ No newline at end of file");
  }
  return out.join("\n");
}
