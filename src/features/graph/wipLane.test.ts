import { describe, expect, it } from "vitest";
import type { Edge } from "../../ipc/types";
import { commit, row } from "../../test/graphFixtures";
import { wipPlacement } from "./wipLane";

const straight = (lane: number, color = 0): Edge => ({
  fromLane: lane,
  toLane: lane,
  kind: "straight",
  color,
  dashed: false,
});

describe("wipPlacement", () => {
  it("stays on HEAD's lane when HEAD is the first row", () => {
    const rows = [row("h", { lane: 0, color: 2 }), row("p")];
    expect(wipPlacement(rows, [commit("h"), commit("p")], 0)).toEqual({
      lane: 0,
      color: 2,
      connected: true,
      throughLane: null,
      joinsFromSide: false,
    });
  });

  it("passes through stash rows on HEAD's lane", () => {
    const rows = [row("s", { lane: 1 }), row("h", { lane: 0, color: 3 })];
    const commits = [commit("s", ["h"], "WIP", { stash: true }), commit("h")];
    expect(wipPlacement(rows, commits, 1)).toMatchObject({
      lane: 0,
      throughLane: 0,
      joinsFromSide: false,
    });
  });

  it("takes the first free lane right of HEAD when another branch's commits are above it", () => {
    // fix/ commits on lane 0 run down into main (HEAD) on lane 0; lane 1 is busy in row 1.
    const rows = [
      row("f2", { lane: 0, edges: [straight(0)] }),
      row("f1", { lane: 0, edges: [straight(0), straight(1, 4)] }),
      row("m", { lane: 0, color: 5, hasIncoming: true, edges: [straight(0)] }),
    ];
    const commits = [commit("f2"), commit("f1"), commit("m")];
    expect(wipPlacement(rows, commits, 2)).toEqual({
      lane: 2,
      color: 5,
      connected: true,
      throughLane: 2,
      joinsFromSide: true,
    });
  });

  it("is disconnected while HEAD is not loaded", () => {
    expect(wipPlacement([row("a")], [commit("a")], undefined).connected).toBe(false);
  });
});
