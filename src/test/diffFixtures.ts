import type { DiffLine, FileDiff, LineKind } from "../ipc/commit";

export function ln(
  kind: LineKind,
  text: string,
  oldNo: number | null,
  newNo: number | null,
  noNewline = false,
): DiffLine {
  return { kind, text, oldNo, newNo, noNewline };
}

export function sampleDiff(): FileDiff {
  return {
    oldPath: "a.ts",
    newPath: "a.ts",
    binary: false,
    oldMode: null,
    newMode: null,
    hunks: [
      {
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        header: "@@ -1,2 +1,2 @@ fn main",
        lines: [
          ln("context", "const a = 1;", 1, 1),
          ln("del", "const b = 2;", 2, null, true),
          ln("add", "const b = 3;", null, 2),
        ],
      },
    ],
  };
}
