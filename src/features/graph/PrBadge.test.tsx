import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PullSummary } from "../../ipc/github";
import type { RepoId } from "../../ipc/types";
import { EMPTY_PULLS, usePullsStore } from "../../state/pulls";
import type { PullsRepo } from "../../state/pulls";
import { PrBadge } from "./PrBadge";

const id = "r1" as RepoId;

const pull: PullSummary = {
  number: 12,
  title: "Add x",
  state: "open",
  draft: false,
  merged: false,
  author: "me",
  headRef: "feat",
  headSha: "abc",
  headRepo: "o/r",
  baseRef: "main",
  baseRepo: "o/r",
  htmlUrl: "",
  createdAt: "",
  updatedAt: "",
  labels: [],
};

describe("PrBadge", () => {
  it("renders #N with a success dot and selects on click", () => {
    const select = vi.fn().mockResolvedValue(undefined);
    const repo: PullsRepo = {
      ...EMPTY_PULLS,
      slug: { remote: "origin", owner: "o", name: "r" },
      pulls: [pull],
      checksBySha: {
        abc: {
          total: 1,
          success: 1,
          failure: 0,
          pending: 0,
          skipped: 0,
          overall: "success",
          runs: [],
        },
      },
    };
    usePullsStore.setState({ byRepo: { [id]: repo }, select });
    render(<PrBadge repoId={id} name="origin/feat" />);
    const b = screen.getByRole("button");
    expect(b.textContent).toBe("#12");
    expect(b.title).toBe("#12 Add x · checks: success");
    expect(screen.getByTestId("pr-dot")).toBeTruthy();
    fireEvent.click(b);
    expect(select).toHaveBeenCalledWith(id, 12);
  });

  it("renders nothing without a mark", () => {
    usePullsStore.setState({ byRepo: {} });
    const { container } = render(<PrBadge repoId={id} name="nope" />);
    expect(container.firstChild).toBeNull();
  });
});
