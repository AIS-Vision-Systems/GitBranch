import { describe, expect, it } from "vitest";
import type { Row } from "../../ipc/types";
import { lanePaths } from "./lanePaths";

const r = (over: Partial<Row>): Row => ({
  oid: "x",
  lane: 0,
  color: 0,
  hasIncoming: true,
  edges: [],
  ...over,
});

// Snapshots regenerated deliberately for D-023: 36 px rows, 22 px lanes and rounded (radius LANE_W/2) merge/branch curves.
describe("lanePaths", () => {
  it("branch tip: no top half, bottom half only", () => {
    const row = r({
      lane: 1,
      color: 2,
      hasIncoming: false,
      edges: [{ fromLane: 1, toLane: 1, kind: "straight", color: 2 }],
    });
    expect(lanePaths(row, row.hasIncoming)).toMatchSnapshot();
  });

  it("straight passthrough on another lane plus the node lane", () => {
    const row = r({
      lane: 0,
      edges: [
        { fromLane: 0, toLane: 0, kind: "straight", color: 0 },
        { fromLane: 1, toLane: 1, kind: "straight", color: 3 },
      ],
    });
    expect(lanePaths(row, true)).toMatchSnapshot();
  });

  it("mergeIn curve ends at the node", () => {
    const row = r({
      lane: 0,
      edges: [
        { fromLane: 2, toLane: 0, kind: "mergeIn", color: 4 },
        { fromLane: 0, toLane: 0, kind: "straight", color: 0 },
      ],
    });
    expect(lanePaths(row, true)).toMatchSnapshot();
  });

  it("branchOut curve starts at the node", () => {
    const row = r({
      lane: 0,
      edges: [
        { fromLane: 0, toLane: 0, kind: "straight", color: 0 },
        { fromLane: 0, toLane: 1, kind: "branchOut", color: 5 },
      ],
    });
    expect(lanePaths(row, true)).toMatchSnapshot();
  });
});
