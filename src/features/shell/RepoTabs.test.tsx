import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenedRepo, RepoId } from "../../ipc/types";
import { useReposStore } from "../../state/repos";
import { RepoTabs } from "./RepoTabs";

function repo(over: Partial<OpenedRepo>): OpenedRepo {
  return {
    repoId: "r1" as RepoId,
    name: "proj",
    path: "/p/proj",
    gitDir: "/p/proj/.git",
    isWorktree: false,
    mainWorkTree: null,
    isBare: false,
    ...over,
  };
}

const main = repo({});
const other = repo({ repoId: "o1" as RepoId, name: "other", path: "/q/other" });
const wt = repo({
  repoId: "w1" as RepoId,
  name: "wt",
  path: "/p/wt",
  isWorktree: true,
  mainWorkTree: "/p/proj",
});

describe("RepoTabs", () => {
  beforeEach(() => {
    useReposStore.setState({ open: [main, other, wt], currentId: "r1" });
  });

  it("groups worktrees next to their main repository", () => {
    render(<RepoTabs />);
    const names = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(names[0]).toContain("proj");
    expect(names[1]).toContain("wt");
    expect(names[2]).toContain("other");
  });

  it("moves focus and selection with arrows, Home and End", () => {
    render(<RepoTabs />);
    const tabs = (): HTMLElement[] => screen.getAllByRole("tab");
    fireEvent.keyDown(tabs()[0]!, { key: "ArrowRight" });
    expect(useReposStore.getState().currentId).toBe("w1");
    expect(document.activeElement).toBe(tabs()[1]);
    fireEvent.keyDown(tabs()[1]!, { key: "End" });
    expect(useReposStore.getState().currentId).toBe("o1");
    fireEvent.keyDown(tabs()[2]!, { key: "ArrowRight" });
    expect(useReposStore.getState().currentId).toBe("r1");
    fireEvent.keyDown(tabs()[0]!, { key: "ArrowLeft" });
    expect(useReposStore.getState().currentId).toBe("o1");
    expect(tabs().filter((t) => t.tabIndex === 0)).toHaveLength(1);
  });

  it("marks the selected tab and the worktree tooltip", () => {
    render(<RepoTabs />);
    expect(screen.getAllByRole("tab")[0]?.getAttribute("aria-selected")).toBe("true");
    const w = screen.getAllByRole("tab")[1]!;
    expect(w.title).toBe("Worktree of /p/proj");
    expect(w.textContent).toContain("⧉");
  });

  it("click selects and Enter selects", () => {
    render(<RepoTabs />);
    fireEvent.click(screen.getAllByRole("tab")[2]!);
    expect(useReposStore.getState().currentId).toBe("o1");
    fireEvent.keyDown(screen.getAllByRole("tab")[1]!, { key: "Enter" });
    expect(useReposStore.getState().currentId).toBe("w1");
  });

  it("close button calls close without selecting", () => {
    const close = vi.fn().mockResolvedValue(undefined);
    useReposStore.setState({ close });
    render(<RepoTabs />);
    fireEvent.click(screen.getByLabelText("Close other"));
    expect(close).toHaveBeenCalledWith("o1");
    expect(useReposStore.getState().currentId).toBe("r1");
  });

  it("shows (bare) for bare repositories", () => {
    useReposStore.setState({ open: [repo({ isBare: true })] });
    render(<RepoTabs />);
    expect(screen.getByText("(bare)")).toBeTruthy();
  });
});
