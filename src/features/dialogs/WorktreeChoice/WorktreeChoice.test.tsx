import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenedRepo, RepoId } from "../../../ipc/types";
import { useReposStore } from "../../../state/repos";
import { WorktreeChoice } from "./WorktreeChoice";

const wt: OpenedRepo = {
  repoId: "w1" as RepoId,
  name: "wt",
  path: "/p/wt",
  gitDir: "/p/proj/.git/worktrees/wt",
  isWorktree: true,
  mainWorkTree: "/p/proj",
  isBare: false,
};

describe("WorktreeChoice", () => {
  const resolveWorktree = vi.fn(() => Promise.resolve());
  const cancelWorktree = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useReposStore.setState({ pendingWorktree: wt, resolveWorktree, cancelWorktree });
  });

  it("renders nothing without a pending worktree", () => {
    useReposStore.setState({ pendingWorktree: null });
    render(<WorktreeChoice />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is an accessible dialog focusing the main button", () => {
    render(<WorktreeChoice />);
    const dialog = screen.getByRole("dialog", { name: /worktree of \/p\/proj/ });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Open main repository" })).toHaveFocus();
  });

  it("Enter chooses main", async () => {
    render(<WorktreeChoice />);
    await userEvent.keyboard("{Enter}");
    expect(resolveWorktree).toHaveBeenCalledWith("main");
  });

  it("Escape cancels", async () => {
    render(<WorktreeChoice />);
    await userEvent.keyboard("{Escape}");
    expect(cancelWorktree).toHaveBeenCalled();
  });

  it("second button opens the worktree", async () => {
    render(<WorktreeChoice />);
    await userEvent.click(screen.getByRole("button", { name: "Open this worktree" }));
    expect(resolveWorktree).toHaveBeenCalledWith("worktree");
  });
});
