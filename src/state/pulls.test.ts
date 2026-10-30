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
describe("refreshQuiet", () => {
  let n = 0;
  let rid = id;
  const seed = (over: Partial<typeof EMPTY_PULLS> = {}): void => {
    n += 1;
    rid = `quiet${n}` as RepoId;
    usePullsStore.setState({
      byRepo: {
        [rid]: {
          ...EMPTY_PULLS,
          slug: { remote: "origin", owner: "o", name: "r" },
          loaded: true,
          pulls: [pull({ number: 1 })],
          ...over,
        },
      },
    });
  };
  const nums = (): number[] => pullsOf(usePullsStore.getState(), rid).pulls.map((p) => p.number);

  it("reloads without a spinner, then refreshes checks", async () => {
    seed();
    const seen: boolean[] = [];
    const unsub = usePullsStore.subscribe((s) => seen.push(pullsOf(s, rid).loading));
    vi.mocked(ipc.githubPulls).mockResolvedValue([pull({ number: 1 }), pull({ number: 2 })]);
    vi.mocked(ipc.githubChecks).mockResolvedValue({});
    await usePullsStore.getState().refreshQuiet(rid, 0);
    unsub();
    expect(nums()).toEqual([1, 2]);
    expect(seen.every((l) => !l)).toBe(true);
    expect(ipc.githubChecks).toHaveBeenCalledWith(rid, ["abc"], false);
  });

  it("keeps the same list reference when nothing changed", async () => {
    seed();
    const before = pullsOf(usePullsStore.getState(), rid).pulls;
    vi.mocked(ipc.githubPulls).mockResolvedValue([pull({ number: 1 })]);
    vi.mocked(ipc.githubChecks).mockResolvedValue({});
    await usePullsStore.getState().refreshQuiet(rid, 0);
    expect(pullsOf(usePullsStore.getState(), rid).pulls).toBe(before);
  });

  it("keeps the list and sets no error when the reload fails", async () => {
    seed();
    vi.mocked(ipc.githubPulls).mockRejectedValue(new Error("offline"));
    await usePullsStore.getState().refreshQuiet(rid, 0);
    const r = pullsOf(usePullsStore.getState(), rid);
    expect(r.error).toBeNull();
    expect(r.errorCode).toBeNull();
    expect(nums()).toEqual([1]);
  });

  it("a 401 signs out", async () => {
    seed();
    vi.mocked(ipc.githubPulls).mockRejectedValue(
      new IpcError({ code: "github.unauthorized", message: "no" }),
    );
    await usePullsStore.getState().refreshQuiet(rid, 0);
    expect(useGithubStore.getState().account).toBeNull();
  });

  it("throttles per repo, with a 15 s floor", async () => {
    seed();
    vi.mocked(ipc.githubPulls).mockResolvedValue([pull({ number: 1 })]);
    vi.mocked(ipc.githubChecks).mockResolvedValue({});
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    await usePullsStore.getState().refreshQuiet(rid, 0);
    now += 14_000;
    await usePullsStore.getState().refreshQuiet(rid, 0);
    expect(ipc.githubPulls).toHaveBeenCalledTimes(1);
    now += 2_000;
    await usePullsStore.getState().refreshQuiet(rid, 60_000);
    expect(ipc.githubPulls).toHaveBeenCalledTimes(1);
    now += 60_000;
    await usePullsStore.getState().refreshQuiet(rid, 60_000);
    expect(ipc.githubPulls).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("is a no-op when not loaded, loading, errored, not a slug or signed out", async () => {
    for (const over of [
      { loaded: false },
      { loading: true },
      { errorCode: "github.network" },
      { slug: null },
      { slug: undefined },
    ]) {
      seed(over);
      await usePullsStore.getState().refreshQuiet(rid, 0);
    }
    seed();
    useGithubStore.setState({ account: null });
    await usePullsStore.getState().refreshQuiet(rid, 0);
    expect(ipc.githubPulls).not.toHaveBeenCalled();
  });

  it("a filter change in between wins", async () => {
    seed();
    let resolveOld: (v: PullSummary[]) => void = () => undefined;
    vi.mocked(ipc.githubPulls)
      .mockImplementationOnce(() => new Promise((r) => (resolveOld = r)))
      .mockResolvedValueOnce([pull({ number: 8, state: "closed" })]);
    vi.mocked(ipc.githubChecks).mockResolvedValue({});
    const q = usePullsStore.getState().refreshQuiet(rid, 0);
    await usePullsStore.getState().setFilter(rid, "closed");
    resolveOld([pull({ number: 99 })]);
    await q;
    expect(nums()).toEqual([8]);
  });

  it("applies the mine filter", async () => {
    seed({ filter: "mine" });
    vi.mocked(ipc.githubPulls).mockResolvedValue([
      pull({ number: 1, author: "me" }),
      pull({ number: 2, author: "you" }),
    ]);
    vi.mocked(ipc.githubChecks).mockResolvedValue({});
    await usePullsStore.getState().refreshQuiet(rid, 0);
    expect(nums()).toEqual([1]);
  });

  it("refreshes the selected detail without a spinner", async () => {
    seed({
      selected: 1,
      detail: { ...pull({ number: 1 }), title: "old" } as PullDetail,
    });
    vi.mocked(ipc.githubPulls).mockResolvedValue([pull({ number: 1 })]);
    vi.mocked(ipc.githubChecks).mockResolvedValue({});
    vi.mocked(ipc.githubPull).mockResolvedValue({
      ...pull({ number: 1 }),
      title: "new",
    } as PullDetail);
    await usePullsStore.getState().refreshQuiet(rid, 0);
    const r = pullsOf(usePullsStore.getState(), rid);
    expect(r.detail?.title).toBe("new");
    expect(r.detailLoading).toBe(false);
  });
});
