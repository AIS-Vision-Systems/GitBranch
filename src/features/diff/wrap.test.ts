import { describe, expect, it } from "vitest";
import { pairHeights } from "./wrap";

describe("pairHeights", () => {
  it("takes the max of each measured pair when wrapping", () => {
    expect(pairHeights(true, [20, 60, 20], [40, 20, 20])).toEqual([40, 60, 20]);
  });
  it("returns null (no forced heights) when wrap is off", () => {
    expect(pairHeights(false, [20, 60], [80, 20])).toBeNull();
  });
});
