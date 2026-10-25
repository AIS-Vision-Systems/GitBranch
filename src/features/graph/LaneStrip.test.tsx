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
    expect(on.container.querySelector("line[data-connector]")?.getAttribute("x1")).toBe("-8");
    on.unmount();
    const off = render(<LaneStrip row={base} lanes={2} isHead={false} />);
    expect(off.container.querySelector("line[data-connector]")).toBeNull();
  });
  it("connector is 2 px on the HEAD row and 1 px elsewhere", () => {
    const head = render(<LaneStrip row={base} lanes={2} isHead connector />);
    expect(head.container.querySelector("line[data-connector]")?.getAttribute("stroke-width")).toBe(
      "2",
    );
    head.unmount();
    const other = render(<LaneStrip row={base} lanes={2} isHead={false} connector />);
    const line = other.container.querySelector("line[data-connector]");
    expect(line?.getAttribute("stroke-width")).toBe("1");
    expect(line?.getAttribute("y1")).toBe("13.5");
  });
  it("draws a faint band from the node to the message bar", () => {
    const { container } = render(<LaneStrip row={base} lanes={2} isHead={false} />);
    const band = container.querySelector("rect[data-band]");
    // Node centre at laneX(lane), ring radius 10; the strip spills 8 px into the right gap.
    const x = base.lane * 22 + 11 + 10;
    expect(band?.getAttribute("x")).toBe(String(x));
    expect(band?.getAttribute("width")).toBe(String(2 * 22 + 8 - x));
    expect(band?.getAttribute("height")).toBe("20");
    expect(container.querySelector("svg")?.getAttribute("width")).toBe(String(2 * 22 + 16));
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
