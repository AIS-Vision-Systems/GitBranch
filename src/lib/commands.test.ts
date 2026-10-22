import { describe, expect, it } from "vitest";
import type { RepoId } from "../ipc/types";
import { useRemotesStore } from "../state/remotes";
import { useReposStore } from "../state/repos";
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

  it("keeps every former toolbar action reachable, plus redo and terminal", () => {
    const id = "r1" as RepoId;
    useReposStore.setState({
      open: [
        {
          repoId: id,
          name: "a",
          path: "/a",
          gitDir: "/a/.git",
          isWorktree: false,
          mainWorkTree: null,
          isBare: false,
        },
      ],
      currentId: id,
    });
    useRemotesStore.setState({
      byRepo: { [id]: [{ name: "origin", fetchUrl: "u", pushUrl: null }] },
    });
    const titles = buildCommands().map((c) => c.title);
    for (const t of [
      "Clone repository",
      "Manage remotes",
      "Open settings",
      "Fetch all remotes",
      "Pull",
      "Push",
      "Undo last operation",
      "Redo",
      "Open terminal",
    ]) {
      expect(titles).toContain(t);
    }
  });
});
