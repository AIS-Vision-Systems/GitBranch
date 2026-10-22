import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { githubCreatePull, githubRepoInfo } from "../../ipc/github";
import type { GithubAccount, GithubRepo, PullSummary } from "../../ipc/github";
import { commitsBetween } from "../../ipc/history";
import type { Ref, RepoId } from "../../ipc/types";
import { EMPTY_GRAPH, useGraphStore } from "../../state/graph";
import { useGithubStore } from "../../state/github";
import { useOpsStore } from "../../state/ops";
import { EMPTY_PULLS, usePullsStore } from "../../state/pulls";
import { useRemotesStore } from "../../state/remotes";
import { CreatePullDialog } from "./CreatePullDialog";

vi.mock("../../ipc/github", () => ({ githubCreatePull: vi.fn(), githubRepoInfo: vi.fn() }));
vi.mock("../../ipc/history", () => ({ commitsBetween: vi.fn() }));

const id = "r1" as RepoId;
const acct: GithubAccount = {
  user: { login: "octo", name: null, avatarUrl: null, htmlUrl: "", email: null },
  scopes: ["repo"],
  offline: false,
};
const remoteRef = (name: string): Ref => ({
  name: `origin/${name}`,
  fullName: `refs/remotes/origin/${name}`,
  kind: { remoteBranch: { remote: "origin" } },
  target: "a",
  upstream: null,
  isHead: false,
});
const local = (upstream: Ref["upstream"]): Ref => ({
  name: "my-feature",
  fullName: "refs/heads/my-feature",
  kind: "localBranch",
  target: "b",
  upstream,
  isHead: true,
});
const c = (subject: string, body = "") => ({ oid: subject, subject, body });
const noop = (): undefined => undefined;
const push = vi.fn();
const loadPulls = vi.fn();
const select = vi.fn();

function setup(upstream: Ref["upstream"]): void {
  useGraphStore.setState({
    byRepo: {
      [id]: {
        ...EMPTY_GRAPH,
        refs: {
          head: { oid: "b", branch: "my-feature", detached: false },
          refs: [local(upstream), remoteRef("main"), remoteRef("dev")],
        },
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  push.mockResolvedValue(true);
  loadPulls.mockResolvedValue(undefined);
  select.mockResolvedValue(undefined);
  useGithubStore.setState({ account: acct });
  useRemotesStore.setState({
    byRepo: { [id]: [{ name: "origin", fetchUrl: "u", pushUrl: null }] },
  });
  usePullsStore.setState({
    byRepo: { [id]: { ...EMPTY_PULLS, slug: { remote: "origin", owner: "o", name: "r" } } },
    loadPulls,
    select,
  });
  useOpsStore.setState({ push });
  vi.mocked(githubRepoInfo).mockResolvedValue({ defaultBranch: "main" } as GithubRepo);
  vi.mocked(githubCreatePull).mockResolvedValue({ number: 7 } as PullSummary);
  vi.mocked(commitsBetween).mockResolvedValue([c("Add thing", "Details here")]);
});

const create = async (): Promise<void> => {
  const btn = await screen.findByRole("button", { name: "Create pull request" });
  await waitFor(() => expect(btn).toBeEnabled());
  fireEvent.click(btn);
  await act(() => Promise.resolve());
};

describe("CreatePullDialog", () => {
  it("prefills title and body from a single commit", async () => {
    setup({ name: "origin/my-feature", ahead: 0, behind: 0, gone: false });
    render(<CreatePullDialog repoId={id} onClose={noop} />);
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Add thing"));
    expect(screen.getByLabelText("Description")).toHaveValue("Details here");
    expect(commitsBetween).toHaveBeenCalledWith(id, "origin/main", "my-feature", 50);
    expect(screen.getByText("1 commit")).toBeInTheDocument();
    expect(screen.getByText("up to date")).toBeInTheDocument();
  });

  it("uses the branch name and a bulleted body (oldest first) for several commits", async () => {
    vi.mocked(commitsBetween).mockResolvedValue([c("Second"), c("First")]);
    setup({ name: "origin/my-feature", ahead: 0, behind: 0, gone: false });
    render(<CreatePullDialog repoId={id} onClose={noop} />);
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("My feature"));
    expect(screen.getByLabelText("Description")).toHaveValue("- First\n- Second");
    expect(screen.getByText("2 commits")).toBeInTheDocument();
  });

  it("pushes before creating when there is no upstream", async () => {
    setup(null);
    render(<CreatePullDialog repoId={id} onClose={noop} />);
    expect(await screen.findByText(/will be pushed to origin\/my-feature/)).toBeInTheDocument();
    await create();
    expect(push).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ remote: "origin", branch: "my-feature", setUpstream: true }),
    );
    expect(githubCreatePull).toHaveBeenCalledWith(id, {
      title: "Add thing",
      body: "Details here",
      head: "my-feature",
      base: "main",
      draft: false,
    });
    expect(push.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(githubCreatePull).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("does not push when up to date and selects the new PR", async () => {
    setup({ name: "origin/my-feature", ahead: 0, behind: 0, gone: false });
    const onClose = vi.fn();
    render(<CreatePullDialog repoId={id} onClose={onClose} />);
    await create();
    expect(push).not.toHaveBeenCalled();
    expect(loadPulls).toHaveBeenCalledWith(id, true);
    expect(select).toHaveBeenCalledWith(id, 7);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("stops when the push fails", async () => {
    push.mockResolvedValue(false);
    setup(null);
    render(<CreatePullDialog repoId={id} onClose={noop} />);
    await create();
    expect(githubCreatePull).not.toHaveBeenCalled();
  });

  it("shows the API error inline", async () => {
    vi.mocked(githubCreatePull).mockRejectedValue(new Error("A pull request already exists"));
    setup({ name: "origin/my-feature", ahead: 0, behind: 0, gone: false });
    render(<CreatePullDialog repoId={id} onClose={noop} />);
    await create();
    expect(await screen.findByText("A pull request already exists")).toBeInTheDocument();
  });

  it("warns and disables Create with no commits", async () => {
    vi.mocked(commitsBetween).mockResolvedValue([]);
    setup({ name: "origin/my-feature", ahead: 0, behind: 0, gone: false });
    render(<CreatePullDialog repoId={id} onClose={noop} />);
    expect(await screen.findByText("No commits between base and head")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create pull request" })).toBeDisabled();
  });

  it("uses the tracked remote branch name as head", async () => {
    setup({ name: "origin/other-name", ahead: 0, behind: 0, gone: false });
    render(<CreatePullDialog repoId={id} onClose={noop} />);
    await create();
    expect(push).not.toHaveBeenCalled();
    expect(githubCreatePull).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ head: "other-name" }),
    );
  });

  it("blocks when the branch tracks another remote", async () => {
    useRemotesStore.setState({
      byRepo: {
        [id]: [
          { name: "origin", fetchUrl: "u", pushUrl: null },
          { name: "fork", fetchUrl: "u", pushUrl: null },
        ],
      },
    });
    setup({ name: "fork/my-feature", ahead: 0, behind: 0, gone: false });
    // Changing remotes resets the pulls slug; restore it.
    usePullsStore.setState({
      byRepo: { [id]: { ...EMPTY_PULLS, slug: { remote: "origin", owner: "o", name: "r" } } },
    });
    render(<CreatePullDialog repoId={id} onClose={noop} />);
    expect(await screen.findByText(/tracks fork\/my-feature, not origin/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create pull request" })).toBeDisabled();
  });

  it("warns when diverged and shows an inline error on a rejected push", async () => {
    push.mockResolvedValue(false);
    setup({ name: "origin/my-feature", ahead: 1, behind: 2, gone: false });
    render(<CreatePullDialog repoId={id} onClose={noop} />);
    expect(await screen.findByText(/have diverged/)).toBeInTheDocument();
    await create();
    expect(await screen.findByText("Push rejected: pull or rebase first")).toBeInTheDocument();
    expect(githubCreatePull).not.toHaveBeenCalled();
  });
});
