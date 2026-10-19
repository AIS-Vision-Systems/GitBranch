import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PullDetail } from "../../ipc/github";
import type { RepoId } from "../../ipc/types";
import { EMPTY_PULLS, usePullsStore } from "../../state/pulls";
import { PullDetailView } from "./PullDetailView";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../../ipc/github", () => ({}));

const id = "r1" as RepoId;
const detail: PullDetail = {
  number: 5,
  title: "Add thing",
  state: "open",
  draft: false,
  merged: false,
  author: "me",
  headRef: "feat",
  headSha: "a",
  headRepo: "fork/r",
  baseRef: "main",
  baseRepo: "o/r",
  htmlUrl: "https://github.com/o/r/pull/5",
  createdAt: "",
  updatedAt: "",
  labels: ["bug"],
  body: "Hello",
  mergeable: true,
  mergeableState: "clean",
  additions: 3,
  deletions: 1,
  changedFiles: 2,
  commits: 2,
  comments: 0,
  reviewComments: 0,
  mergedBy: null,
  reviews: { approved: 1, changesRequested: 0, commented: 0, reviewers: [] },
  checks: {
    total: 2,
    success: 1,
    failure: 1,
    pending: 0,
    skipped: 0,
    overall: "failure",
    runs: [
      { name: "build", status: "completed", conclusion: "success", htmlUrl: null },
      { name: "lint", status: "completed", conclusion: "failure", htmlUrl: null },
    ],
  },
};

beforeEach(() => {
  usePullsStore.setState({
    byRepo: { [id]: { ...EMPTY_PULLS, selected: 5, detail } },
  });
});

describe("PullDetailView", () => {
  it("renders the checks summary", () => {
    render(<PullDetailView repoId={id} />);
    expect(screen.getByText("1 of 2 passed")).toBeTruthy();
    expect(screen.getByText("build")).toBeTruthy();
    expect(screen.getByText("fork/r:feat")).toBeTruthy();
  });

  it("Checkout calls the store with the pull", () => {
    const checkout = vi.fn().mockResolvedValue("pr-5");
    usePullsStore.setState({ checkout });
    render(<PullDetailView repoId={id} />);
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    expect(checkout).toHaveBeenCalledWith(id, detail);
  });
});
