import type { Blame, BlameHunk } from "../../ipc/blame";

export interface BlameRow {
  /** 1-based line number. */
  line: number;
  text: string;
  hunk: BlameHunk;
  /** First line of its hunk: the only row showing the gutter details. */
  first: boolean;
  /** Alternating shade index of the hunk (0 or 1). */
  shade: 0 | 1;
}

/** Not-yet-committed lines are blamed on the all-zero oid. */
export function isUncommitted(oid: string): boolean {
  return /^0+$/.test(oid);
}

/** Flatten hunks into one row per source line. Lines no hunk covers are skipped. */
export function buildBlameRows(b: Blame): BlameRow[] {
  const rows: BlameRow[] = [];
  b.hunks.forEach((hunk, hi) => {
    for (let k = 0; k < hunk.lineCount; k++) {
      const line = hunk.startLine + k;
      const text = b.lines[line - 1];
      if (text === undefined) break;
      rows.push({ line, text, hunk, first: k === 0, shade: (hi % 2) as 0 | 1 });
    }
  });
  return rows;
}
