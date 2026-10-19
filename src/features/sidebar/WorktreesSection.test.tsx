import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenedRepo, RepoId } from "../../ipc/types";
import type { Worktree } from "../../ipc/worktree";
import { useReposStore } from "../../state/repos";
import { useWorktreesStore } from "../../state/worktrees";
import { WorktreesSection } from "./WorktreesSection";

vi.mock("../../ipc/worktree", () => ({}));

const id = "r1" as RepoId;
const wt = (over: Partial<Worktree>): Worktree => ({
  path: "/x",
  headOid: "1234567890",
  branch: null,
  isMain: false,
  isBare: false,
  isDetached: false,
  locked: false,
  lockReason: null,
  prunable: false,
  pruneReason: null,
  ...over,
});

function setup(list: Worktree[]): void {
  const repo: OpenedRepo = {
    repoId: id,
    name: "r",
    path: "C:\\repo",
    gitDir: "C:\\repo\\.git",
    isWorktree: false,
    mainWorkTree: null,
    isBare: false,
  };
  useReposStore.setState({ open: [repo], currentId: id });
  useWorktreesStore.setState({ byRepo: { [id]: list } });
  render(<WorktreesSection repoId={id} />);
}

describe("WorktreesSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders badges and variants", () => {
    setup([
      wt({ path: "C:/repo", branch: "trunk", isMain: true }),
      wt({ path: "/b", isDetached: true, locked: true, lockReason: "usb" }),
      wt({ path: "/c", branch: "gone", prunable: true, pruneReason: "missing" }),
    ]);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText("main")).toBeTruthy();
    expect(within(rows[0]!).getByText("current")).toBeTruthy();
    expect(within(rows[1]!).getByText("detached @ 1234567")).toBeTruthy();
    expect(within(rows[1]!).getByText("locked")).toHaveAttribute("title", "usb");
    expect(within(rows[2]!).getByText("prunable")).toHaveAttribute("title", "missing");
  });

  it("disables Prune when nothing is prunable", () => {
    setup([wt({ branch: "a" })]);
    expect(screen.getByRole("button", { name: "Prune" })).toBeDisabled();
  });

  it("enables Prune when an entry is prunable", () => {
    setup([wt({ branch: "a", prunable: true })]);
    expect(screen.getByRole("button", { name: "Prune" })).toBeEnabled();
  });

  it("hides Remove on the main worktree and shows Unlock for locked", () => {
    setup([wt({ branch: "m", isMain: true }), wt({ path: "/b", branch: "b", locked: true })]);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]!).queryByRole("button", { name: "Remove" })).toBeNull();
    expect(within(rows[0]!).getByRole("button", { name: "Lock" })).toBeTruthy();
    expect(within(rows[1]!).getByRole("button", { name: "Remove" })).toBeTruthy();
    expect(within(rows[1]!).getByRole("button", { name: "Unlock" })).toBeTruthy();
  });
});
