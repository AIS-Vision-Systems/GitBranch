import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Row } from "../../ipc/types";
import { lanePaths } from "./lanePaths";
import { LaneStrip } from "./LaneStrip";

describe("LaneStrip node", () => {
  const base: Row = { oid: "x", lane: 1, color: 2, hasIncoming: true, edges: [] };
  it("draws a clipped photo instead of initials when avatarUrl is set", () => {
    const { container } = render(
      <LaneStrip
        row={base}
        lanes={2}
        isHead={false}
        initials="AB"
        avatarUrl="data:image/png;base64,AA"
      />,
    );
    const img = container.querySelector("image");
    expect(img?.getAttribute("href")).toBe("data:image/png;base64,AA");
    expect(img?.getAttribute("clip-path")).toMatch(/^url\(#avclip-/);
    expect(container.querySelector("clipPath circle")).not.toBeNull();
    expect(container.querySelector("text")).toBeNull();
  });
  it("shows initials without a photo", () => {
    const { container } = render(<LaneStrip row={base} lanes={2} isHead={false} initials="AB" />);
    expect(container.querySelector("image")).toBeNull();
    expect(container.querySelector("text")?.textContent).toBe("AB");
  });
  it("draws the connector line only when asked", () => {
    const on = render(<LaneStrip row={base} lanes={2} isHead={false} connector />);
    expect(on.container.querySelector("line[data-connector]")?.getAttribute("x1")).toBe("0");
    on.unmount();
    const off = render(<LaneStrip row={base} lanes={2} isHead={false} />);
    expect(off.container.querySelector("line[data-connector]")).toBeNull();
  });
});

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
