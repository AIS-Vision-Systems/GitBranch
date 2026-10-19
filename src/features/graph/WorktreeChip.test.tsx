import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useReposStore } from "../../state/repos";
import { WorktreeChip } from "./WorktreeChip";

describe("WorktreeChip", () => {
  it("shows the label and a title with path and branch", () => {
    render(<WorktreeChip mark={{ path: "/p/wt", label: "wt", branch: "feat" }} />);
    const b = screen.getByRole("button");
    expect(b.textContent).toBe("⧉wt");
    expect(b.title).toBe("Checked out in worktree /p/wt on feat");
  });

  it("omits the branch for a detached worktree and opens it on click", () => {
    const openWorktree = vi.fn().mockResolvedValue(undefined);
    useReposStore.setState({ openWorktree });
    render(<WorktreeChip mark={{ path: "/p/wt", label: "wt", branch: null }} />);
    const b = screen.getByRole("button");
    expect(b.title).toBe("Checked out in worktree /p/wt");
    fireEvent.click(b);
    expect(openWorktree).toHaveBeenCalledWith("/p/wt");
  });
});
