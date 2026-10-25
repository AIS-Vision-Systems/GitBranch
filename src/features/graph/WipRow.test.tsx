import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { COL_GAP, LANE_W } from "./constants";
import { WipRow } from "./WipRow";

describe("WipRow", () => {
  it("spills into the column gaps like LaneStrip so the node stays on its lane", () => {
    const { container } = render(
      <WipRow
        fileCount={2}
        lane={1}
        color={3}
        lanes={3}
        connected
        top={0}
        selected={false}
        hovered={false}
        onSelect={vi.fn()}
        onHover={vi.fn()}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe(String(3 * LANE_W + 2 * COL_GAP));
    expect(svg?.querySelector("g")?.getAttribute("transform")).toBe(`translate(${COL_GAP} 0)`);
    // Node centre at laneX(1) inside the translated group.
    expect(svg?.querySelector("circle")?.getAttribute("cx")).toBe(String(LANE_W + LANE_W / 2));
    expect(svg?.querySelector("path")).not.toBeNull();
  });
});
