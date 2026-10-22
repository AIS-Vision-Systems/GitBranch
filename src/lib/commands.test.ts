import { describe, expect, it } from "vitest";
import { useUiStore } from "../state/ui";
import { buildCommands } from "./commands";

describe("buildCommands", () => {
  it("includes a Toggle sidebar command that flips the store", () => {
    const cmd = buildCommands().find((c) => c.title === "Toggle sidebar");
    expect(cmd).toBeDefined();
    const before = useUiStore.getState().sidebarOpen;
    void cmd?.run();
    expect(useUiStore.getState().sidebarOpen).toBe(!before);
  });

  it("includes About GitBranch", () => {
    expect(buildCommands().some((c) => c.title === "About GitBranch")).toBe(true);
  });
});
