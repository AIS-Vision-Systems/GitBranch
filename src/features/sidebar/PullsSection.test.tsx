import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubAccount, GithubRepoSlug, PullSummary } from "../../ipc/github";
import type { RepoId } from "../../ipc/types";
import { useGithubStore } from "../../state/github";
import { EMPTY_PULLS, usePullsStore } from "../../state/pulls";
import { PullsSection } from "./PullsSection";

vi.mock("../../ipc/github", () => ({
  githubRepoSlug: vi.fn(),
  githubPulls: vi.fn(),
  githubPull: vi.fn(),
  githubCheckoutPull: vi.fn(),
}));

const id = "r1" as RepoId;
const slug: GithubRepoSlug = { remote: "origin", owner: "o", name: "r" };
const account = { user: { login: "me" }, scopes: [], offline: false } as unknown as GithubAccount;
const pr = (number: number, title: string): PullSummary => ({
  number,
  title,
  state: "open",
  draft: number === 2,
  merged: false,
  author: "me",
  headRef: "f",
  headSha: "a",
  headRepo: "o/r",
  baseRef: "main",
  baseRepo: "o/r",
  htmlUrl: "",
  createdAt: "",
  updatedAt: "",
  labels: [],
});

function setup(s: GithubRepoSlug | null, acct: GithubAccount | null, pulls: PullSummary[] = []) {
  useGithubStore.setState({ account: acct });
  usePullsStore.setState({
    byRepo: { [id]: { ...EMPTY_PULLS, slug: s, pulls, loaded: true } },
  });
}

beforeEach(() => {
  usePullsStore.setState({ byRepo: {} });
});

describe("PullsSection", () => {
  it("is hidden for non-GitHub repos", () => {
    setup(null, account);
    const { container } = render(<PullsSection repoId={id} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("asks to sign in when signed out", () => {
    setup(slug, null);
    render(<PullsSection repoId={id} />);
    expect(screen.getByText("Sign in to GitHub to see pull requests")).toBeTruthy();
  });

  it("lists rows and selects on click", () => {
    setup(slug, account, [pr(1, "First"), pr(2, "Second")]);
    const select = vi.fn().mockResolvedValue(undefined);
    usePullsStore.setState({ select });
    render(<PullsSection repoId={id} />);
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByText("draft")).toBeTruthy();
    fireEvent.click(screen.getByText("Second"));
    expect(select).toHaveBeenCalledWith(id, 2);
  });
});
