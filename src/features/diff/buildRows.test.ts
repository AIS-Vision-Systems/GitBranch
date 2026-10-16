import { describe, expect, it } from "vitest";
import { sampleDiff } from "../../test/diffFixtures";
import { buildRows } from "./buildRows";

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
