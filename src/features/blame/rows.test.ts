import { describe, expect, it } from "vitest";
import type { BlameHunk } from "../../ipc/blame";
import { buildBlameRows, isUncommitted } from "./rows";

const h = (oid: string, startLine: number, lineCount: number): BlameHunk => ({
  oid,
  author: "A",
  authorTime: 1,
  summary: "s",
  startLine,
  lineCount,
  boundary: false,
  path: "f",
});

describe("buildBlameRows", () => {
  it("maps hunks to one row per line with first/shade", () => {
    const rows = buildBlameRows({
      hunks: [h("a", 1, 2), h("b", 3, 1), h("c", 4, 1)],
      lines: ["l1", "l2", "l3", "l4"],
    });
    expect(rows.map((r) => [r.line, r.text, r.first, r.shade])).toEqual([
      [1, "l1", true, 0],
      [2, "l2", false, 0],
      [3, "l3", true, 1],
      [4, "l4", true, 0],
    ]);
  });

  it("stops at missing lines", () => {
    expect(buildBlameRows({ hunks: [h("a", 1, 5)], lines: ["x"] })).toHaveLength(1);
  });

  it("detects uncommitted oids", () => {
    expect(isUncommitted("0".repeat(40))).toBe(true);
    expect(isUncommitted("abc")).toBe(false);
  });
});
