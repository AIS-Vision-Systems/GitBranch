import type { DiffLine, FileDiff, Hunk } from "../../ipc/commit";
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
  | { type: "nonl"; key: string }
  /** An unchanged line outside every hunk (whole-file view); never selectable. */
  | { type: "ctx"; key: string; line: DiffLine };

/** First new-side line a hunk covers (git reports the line BEFORE a pure deletion). */
function firstNew(h: Hunk): number {
  return h.newLines === 0 ? h.newStart + 1 : h.newStart;
}

/** Old and new line numbers of the first unchanged line after a hunk. */
function afterHunk(h: Hunk): { old: number; new: number } {
  return {
    old: h.oldLines === 0 ? h.oldStart + 1 : h.oldStart + h.oldLines,
    new: h.newLines === 0 ? h.newStart + 1 : h.newStart + h.newLines,
  };
}

/** The new-side text as lines: split on "\n" like the diff parser, dropping the final empty piece. */
function splitText(text: string): string[] {
  const parts = text.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** Context rows for new-side lines `from..=to` (1-based), old number = new + offset. */
function gap(rows: DiffRow[], lines: string[], from: number, to: number, offset: number): void {
  for (let n = from; n <= to; n++) {
    const text = lines[n - 1];
    if (text === undefined) return;
    rows.push({
      type: "ctx",
      key: `c${n}`,
      line: { kind: "context", text, oldNo: n + offset, newNo: n, noNewline: false },
    });
  }
}

/** Index of the first added/deleted row, or -1 when there is none. */
export function firstChangeIndex(rows: readonly DiffRow[]): number {
  return rows.findIndex((r) =>
    r.type === "line"
      ? r.line.kind !== "context"
      : r.type === "split" && (r.left?.kind === "del" || r.right?.kind === "add"),
  );
}

export function buildRows(diff: FileDiff, view: DiffViewMode, fullText?: string | null): DiffRow[] {
  const rows: DiffRow[] = [];
  const lines = fullText === null || fullText === undefined ? null : splitText(fullText);
  diff.hunks.forEach((h, hi) => {
    if (lines !== null) {
      if (hi === 0) {
        const oldFirst = h.oldLines === 0 ? h.oldStart + 1 : h.oldStart;
        gap(rows, lines, 1, firstNew(h) - 1, oldFirst - firstNew(h));
      } else {
        const prev = afterHunk(diff.hunks[hi - 1]!);
        gap(rows, lines, prev.new, firstNew(h) - 1, prev.old - prev.new);
      }
    }
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
  const last = diff.hunks[diff.hunks.length - 1];
  if (lines !== null && last !== undefined) {
    const a = afterHunk(last);
    gap(rows, lines, a.new, lines.length, a.old - a.new);
  }
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
