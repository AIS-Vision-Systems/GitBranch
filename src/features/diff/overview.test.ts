import { describe, expect, it } from "vitest";
import { ln } from "../../test/diffFixtures";
import type { FileDiff } from "../../ipc/commit";
import { buildRows } from "./buildRows";
import { overviewMarks } from "./overview";

function diffOf(lines: ReturnType<typeof ln>[]): FileDiff {
  return {
    oldPath: "a",
    newPath: "a",
    binary: false,
    oldMode: null,
    newMode: null,
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, header: "@@", lines }],
  };
}

describe("overviewMarks", () => {
  it("is empty without rows", () => {
    expect(overviewMarks([])).toEqual([]);
  });

  it("marks add, delete and modify runs in 0..1 units (unified)", () => {
    const rows = buildRows(
      diffOf([
        ln("context", "c", 1, 1),
        ln("add", "a", null, 2),
        ln("context", "c", 2, 3),
        ln("del", "d", 3, null),
        ln("context", "c", 4, 4),
        ln("del", "d", 5, null),
        ln("add", "a", null, 5),
      ]),
      "unified",
    );
    // hunk + 7 lines = 8 rows
    const marks = overviewMarks(rows);
    expect(marks.map((m) => [m.kind, m.side])).toEqual([
      ["added", "right"],
      ["deleted", "left"],
      ["deleted", "left"],
      ["added", "right"],
    ]);
    expect(marks[0]).toEqual({ top: 2 / 8, height: 1 / 8, kind: "added", side: "right" });
    expect(marks[2]!.top).toBeCloseTo(6 / 8);
    expect(marks[3]!.height).toBeCloseTo(2 / 8);
  });

  it("draws a modification as one mark on each half", () => {
    const rows = buildRows(
      diffOf([ln("del", "d", 1, null), ln("add", "a", null, 1), ln("add", "b", null, 2)]),
      "split",
    );
    const marks = overviewMarks(rows);
    expect(marks.map((m) => m.side).sort()).toEqual(["left", "right"]);
  });
});
