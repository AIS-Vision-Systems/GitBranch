import { beforeEach, describe, expect, it } from "vitest";
import { useTreeExpansionStore } from "./treeExpansion";

describe("treeExpansion store", () => {
  beforeEach(() => useTreeExpansionStore.getState().reset());

  it("returns undefined for unknown keys", () => {
    expect(useTreeExpansionStore.getState().get("nope")).toBeUndefined();
  });

  it("stores values per key", () => {
    const s = useTreeExpansionStore.getState();
    const set = new Set(["src"]);
    s.set("a", set);
    s.set("b", "all");
    expect(useTreeExpansionStore.getState().get("a")).toBe(set);
    expect(useTreeExpansionStore.getState().get("b")).toBe("all");
  });

  it("reset clears everything", () => {
    useTreeExpansionStore.getState().set("a", "all");
    useTreeExpansionStore.getState().reset();
    expect(useTreeExpansionStore.getState().get("a")).toBeUndefined();
  });
});
