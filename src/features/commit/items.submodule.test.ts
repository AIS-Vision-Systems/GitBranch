import { describe, expect, it } from "vitest";
import type { StatusEntry } from "../../ipc/types";
import { wipItems } from "./items";

const entry = (submodule: boolean): StatusEntry => ({
  path: "lib/sub",
  origPath: null,
  staged: "unmodified",
  unstaged: "modified",
  conflicted: false,
  submodule,
});

describe("wipItems submodule tag", () => {
  it("flags submodule entries only", () => {
    expect(wipItems([entry(true)])[0]?.submodule).toBe(true);
    expect(wipItems([entry(false)])[0]?.submodule).toBeUndefined();
  });
});
