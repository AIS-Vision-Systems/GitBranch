import { describe, expect, it } from "vitest";
import type { FileDiff, Hunk } from "../../ipc/commit";
import { ln, sampleDiff } from "../../test/diffFixtures";
import { buildRows, firstChangeIndex } from "./buildRows";

describe("buildRows indices", () => {
  it("unified rows carry hunkIndex and lineIndex", () => {
    const rows = buildRows(sampleDiff(), "unified");
    expect(rows[0]).toMatchObject({ type: "hunk", hunkIndex: 0 });
    const lines = rows.filter((r) => r.type === "line");
    expect(lines.map((r) => (r.type === "line" ? [r.hunkIndex, r.lineIndex] : []))).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
  });

  it("split rows carry indices of both sides", () => {
    const rows = buildRows(sampleDiff(), "split");
    const split = rows.filter((r) => r.type === "split");
    expect(split).toHaveLength(2);
    expect(split[0]).toMatchObject({ leftIndex: 0, rightIndex: 0 });
    expect(split[1]).toMatchObject({ hunkIndex: 0, leftIndex: 1, rightIndex: 2 });
  });
});

function diffOf(hunks: Hunk[]): FileDiff {
  return { oldPath: "a", newPath: "a", binary: false, oldMode: null, newMode: null, hunks };
}

const nums = (rows: ReturnType<typeof buildRows>): string[] =>
  rows.flatMap((r) => (r.type === "ctx" ? [`${r.line.oldNo}/${r.line.newNo}:${r.line.text}`] : []));

describe("buildRows whole file", () => {
  const replace: Hunk = {
    oldStart: 3,
    oldLines: 1,
    newStart: 3,
    newLines: 1,
    header: "@@ -3 +3 @@",
    lines: [ln("del", "l3", 3, null), ln("add", "X", null, 3)],
  };
  const del: Hunk = {
    oldStart: 5,
    oldLines: 1,
    newStart: 4,
    newLines: 0,
    header: "@@ -5 +4,0 @@",
    lines: [ln("del", "l5", 5, null)],
  };
  const add: Hunk = {
    oldStart: 6,
    oldLines: 0,
    newStart: 7,
    newLines: 1,
    header: "@@ -6,0 +7 @@",
    lines: [ln("add", "Y", null, 7)],
  };

  it("fills before, between and after hunks with consistent numbers", () => {
    const rows = buildRows(diffOf([replace, del]), "unified", "l1\nl2\nX\nl4\nl6\n");
    expect(nums(rows)).toEqual(["1/1:l1", "2/2:l2", "4/4:l4", "6/5:l6"]);
    expect(rows[0]).toMatchObject({ type: "ctx", key: "c1" });
  });

  it("handles a pure add hunk and a text without trailing newline", () => {
    const rows = buildRows(diffOf([add]), "unified", "a\nb\nc\nd\ne\nf\nY\nz");
    expect(nums(rows)).toEqual(["1/1:a", "2/2:b", "3/3:c", "4/4:d", "5/5:e", "6/6:f", "7/8:z"]);
    expect(rows.findIndex((r) => r.type === "hunk")).toBe(6);
  });

  it("numbers lines after a pure deletion from the line before it", () => {
    const d: Hunk = { ...del, oldStart: 3, newStart: 2 };
    const rows = buildRows(diffOf([d]), "split", "a\nb\nd\ne\n");
    expect(nums(rows)).toEqual(["1/1:a", "2/2:b", "4/3:d", "5/4:e"]);
  });

  it("is unchanged without full text", () => {
    expect(buildRows(sampleDiff(), "unified", null)).toEqual(buildRows(sampleDiff(), "unified"));
  });

  it("finds the first changed row", () => {
    const rows = buildRows(diffOf([replace]), "split", "l1\nl2\nX\nl4");
    expect(firstChangeIndex(rows)).toBe(3);
    expect(firstChangeIndex([])).toBe(-1);
  });
});
