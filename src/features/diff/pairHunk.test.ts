import { describe, expect, it } from "vitest";
import type { Hunk } from "../../ipc/commit";
import { ln } from "../../test/diffFixtures";
import { pairHunk } from "./pairHunk";

const hunk = (lines: Hunk["lines"]): Hunk => ({
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 1,
  header: "",
  lines,
});

describe("pairHunk", () => {
  it("puts context on both sides", () => {
    const c = ln("context", "a", 1, 1);
    expect(pairHunk(hunk([c]))).toEqual([{ left: c, right: c }]);
  });
  it("pairs del/add runs line by line", () => {
    const d1 = ln("del", "x", 1, null);
    const d2 = ln("del", "y", 2, null);
    const a1 = ln("add", "z", null, 1);
    expect(pairHunk(hunk([d1, d2, a1]))).toEqual([
      { left: d1, right: a1 },
      { left: d2, right: null },
    ]);
  });
  it("handles pure additions and extra adds", () => {
    const a1 = ln("add", "a", null, 1);
    const d1 = ln("del", "d", 1, null);
    const a2 = ln("add", "b", null, 2);
    const a3 = ln("add", "c", null, 3);
    expect(pairHunk(hunk([a1]))).toEqual([{ left: null, right: a1 }]);
    expect(pairHunk(hunk([d1, a2, a3]))).toEqual([
      { left: d1, right: a2 },
      { left: null, right: a3 },
    ]);
  });
});
