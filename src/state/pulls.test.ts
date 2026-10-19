import { beforeEach, describe, expect, it, vi } from "vitest";
import { IpcError } from "../ipc/core";
import * as ipc from "../ipc/github";
import type { GithubAccount, PullDetail, PullSummary } from "../ipc/github";
import type { RepoId } from "../ipc/types";
import { useGithubStore } from "./github";
import { useOpsStore } from "./ops";
import { EMPTY_PULLS, prMarks, pullsOf, usePullsStore } from "./pulls";

vi.mock("../ipc/github", () => ({
  githubRepoSlug: vi.fn(),
  githubPulls: vi.fn(),
  githubPull: vi.fn(),
  githubChecks: vi.fn(),
  githubCheckoutPull: vi.fn(),
  githubAccount: vi.fn(),
  githubRepos: vi.fn(),
  githubLogout: vi.fn(),
}));

const id = "r1" as RepoId;
const pull = (over: Partial<PullSummary>): PullSummary => ({
  number: 1,
  title: "t",
  state: "open",
  draft: false,
  merged: false,
  author: "me",
  headRef: "feat",
  headSha: "abc",
  headRepo: "o/r",
  baseRef: "main",
  baseRepo: "o/r",
  htmlUrl: "https://github.com/o/r/pull/1",
  createdAt: "",
  updatedAt: "",
  labels: [],
  ...over,
});
const account = { user: { login: "me" }, scopes: [], offline: false } as unknown as GithubAccount;

beforeEach(() => {
  vi.resetAllMocks();
  usePullsStore.setState({ byRepo: {} });
  useGithubStore.setState({ account });
});

describe("pulls store", () => {
  it("loads the slug", async () => {
    vi.mocked(ipc.githubRepoSlug).mockResolvedValue({ remote: "origin", owner: "o", name: "r" });
    await usePullsStore.getState().loadSlug(id);
    expect(pullsOf(usePullsStore.getState(), id).slug?.remote).toBe("origin");
  });

  it("loads the open list", async () => {
    vi.mocked(ipc.githubPulls).mockResolvedValue([pull({ number: 3 })]);
    await usePullsStore.getState().loadPulls(id);
    expect(ipc.githubPulls).toHaveBeenCalledWith(id, "open");
    expect(pullsOf(usePullsStore.getState(), id).pulls.map((p) => p.number)).toEqual([3]);
  });

  it("mine asks for all and filters by author", async () => {
    vi.mocked(ipc.githubPulls).mockResolvedValue([
      pull({ number: 1, author: "me" }),
      pull({ number: 2, author: "you" }),
    ]);
    await usePullsStore.getState().setFilter(id, "mine");
    expect(ipc.githubPulls).toHaveBeenCalledWith(id, "all");
    expect(pullsOf(usePullsStore.getState(), id).pulls.map((p) => p.number)).toEqual([1]);
  });

  it("select loads the detail", async () => {
    vi.mocked(ipc.githubPull).mockResolvedValue({ ...pull({ number: 7 }) } as PullDetail);
    await usePullsStore.getState().select(id, 7);
    const r = pullsOf(usePullsStore.getState(), id);
    expect(r.selected).toBe(7);
    expect(r.detail?.number).toBe(7);
    await usePullsStore.getState().select(id, null);
    expect(pullsOf(usePullsStore.getState(), id).detail).toBeNull();
  });

  it("checkout builds args for same-repo and fork PRs", async () => {
    const spy = vi.fn().mockResolvedValue("pr-1");
    useOpsStore.setState({ checkoutPull: spy });
    vi.mocked(ipc.githubRepoSlug).mockResolvedValue({ remote: "origin", owner: "o", name: "r" });
    await usePullsStore.getState().loadSlug(id);
    await usePullsStore.getState().checkout(id, pull({ number: 1 }));
    expect(spy).toHaveBeenLastCalledWith(id, 1, {
      remote: "origin",
      number: 1,
      headRef: "feat",
      sameRepo: true,
    });
    await usePullsStore.getState().checkout(id, pull({ number: 2, headRepo: "fork/r" }));
    expect(spy).toHaveBeenLastCalledWith(id, 2, {
      remote: "origin",
      number: 2,
      headRef: "feat",
      sameRepo: false,
    });
  });

  it("keeps load counters per repo (two repos in flight)", async () => {
    const b = "r2" as RepoId;
    let resolveA: (v: PullSummary[]) => void = () => undefined;
    vi.mocked(ipc.githubPulls)
      .mockImplementationOnce(() => new Promise((r) => (resolveA = r)))
      .mockResolvedValueOnce([pull({ number: 9 })]);
    const pa = usePullsStore.getState().loadPulls(id);
    await usePullsStore.getState().loadPulls(b);
    resolveA([pull({ number: 4 })]);
    await pa;
    const st = usePullsStore.getState();
    expect(pullsOf(st, id).loading).toBe(false);
    expect(pullsOf(st, id).pulls.map((p) => p.number)).toEqual([4]);
    expect(pullsOf(st, b).pulls.map((p) => p.number)).toEqual([9]);
  });

  it("force supersedes an in-flight load", async () => {
    let resolveOld: (v: PullSummary[]) => void = () => undefined;
    vi.mocked(ipc.githubPulls)
      .mockImplementationOnce(() => new Promise((r) => (resolveOld = r)))
      .mockResolvedValueOnce([pull({ number: 2 })]);
    const old = usePullsStore.getState().loadPulls(id);
    await usePullsStore.getState().loadPulls(id, true);
    resolveOld([pull({ number: 1 })]);
    await old;
    expect(pullsOf(usePullsStore.getState(), id).pulls.map((p) => p.number)).toEqual([2]);
  });

  it("a 401 signs out locally and does not retry", async () => {
    vi.mocked(ipc.githubPulls).mockRejectedValue(
      new IpcError({ code: "github.unauthorized", message: "no" }),
    );
    await usePullsStore.getState().loadPulls(id);
    expect(useGithubStore.getState().account).toBeNull();
    expect(pullsOf(usePullsStore.getState(), id).loading).toBe(false);
    await usePullsStore.getState().loadPulls(id);
    expect(ipc.githubPulls).toHaveBeenCalledTimes(1);
  });
});

describe("checks and prMarks", () => {
  const slug = { remote: "origin", owner: "o", name: "r" };
  const sum = (overall: "success" | "failure"): ipc.ChecksSummary => ({
    total: 1,
    success: 0,
    failure: 0,
    pending: 0,
    skipped: 0,
    overall,
    runs: [],
  });

  it("loads checks for open PR shas after loadPulls", async () => {
    vi.mocked(ipc.githubPulls).mockResolvedValue([
      pull({ number: 1, headSha: "a" }),
      pull({ number: 2, headSha: "a" }),
      pull({ number: 3, headSha: "b" }),
    ]);
    vi.mocked(ipc.githubChecks).mockResolvedValue({ a: sum("success") });
    await usePullsStore.getState().loadPulls(id);
    expect(ipc.githubChecks).toHaveBeenCalledWith(id, ["a", "b"], false);
    await vi.waitFor(() =>
      expect(pullsOf(usePullsStore.getState(), id).checksBySha["a"]?.overall).toBe("success"),
    );
  });

  it("marks same-repo open PRs by both names, lowest number wins", () => {
    const repo = {
      ...EMPTY_PULLS,
      slug,
      pulls: [
        pull({ number: 9, headRef: "feat", headSha: "a" }),
        pull({ number: 4, headRef: "feat", headSha: "a", draft: true }),
        pull({ number: 5, headRef: "fork", headRepo: "x/r" }),
        pull({ number: 6, headRef: "old", state: "closed" }),
        pull({ number: 7, headRef: "nochk", headSha: "z" }),
      ],
      checksBySha: { a: sum("failure") },
    };
    const m = prMarks(repo);
    expect(m.get("feat")).toMatchObject({ number: 4, draft: true, overall: "failure" });
    expect(m.get("origin/feat")).toBe(m.get("feat"));
    expect(m.get("nochk")?.overall).toBe("unknown");
    expect(m.has("fork")).toBe(false);
    expect(m.has("old")).toBe(false);
    expect(prMarks(repo)).toBe(m);
  });
});
