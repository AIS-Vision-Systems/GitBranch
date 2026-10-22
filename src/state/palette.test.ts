import { describe, expect, it } from "vitest";
import { filterCommands } from "./palette";

const cmds = [
  { title: "Open repository" },
  { title: "Clone repository" },
  { title: "Fetch" },
  { title: "Checkout branch: main" },
  { title: "Create branch" },
];
const titles = (q: string): string[] => filterCommands(q, cmds).map((c) => c.title);

describe("filterCommands", () => {
  it("returns everything for an empty query", () => {
    expect(titles("  ")).toHaveLength(cmds.length);
  });
  it("is case-insensitive substring, prefix first", () => {
    expect(titles("REPO")).toEqual(["Open repository", "Clone repository"]);
    expect(titles("create")[0]).toBe("Create branch");
  });
  it("falls back to fuzzy subsequence", () => {
    expect(titles("ftch")).toEqual(["Fetch"]);
    expect(titles("zzz")).toEqual([]);
  });
});
