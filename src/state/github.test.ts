import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ipc from "../ipc/github";
import type { GithubAccount, GithubRepo } from "../ipc/github";
import { IpcError } from "../ipc/core";
import { useGithubStore } from "./github";

vi.mock("../ipc/github", () => ({
  githubAccount: vi.fn(),
  githubLoginStart: vi.fn(),
  githubLoginWait: vi.fn(),
  githubLoginCancel: vi.fn(),
  githubLogout: vi.fn(),
  githubRepos: vi.fn(),
  githubStatus: vi.fn(),
}));

const acct: GithubAccount = {
  user: {
    login: "octo",
    name: "Octo Cat",
    avatarUrl: null,
    htmlUrl: "https://github.com/octo",
    email: null,
  },
  scopes: ["repo"],
  offline: false,
};
const device = {
  userCode: "ABCD-1234",
  verificationUri: "https://github.com/login/device",
  expiresIn: 900,
  interval: 5,
};

beforeEach(() => {
  vi.resetAllMocks();
  useGithubStore.setState({
    account: undefined,
    loading: false,
    error: null,
    login: { step: "idle" },
    repos: null,
    reposLoading: false,
    reposError: null,
  });
});

describe("github store", () => {
  it("refresh sets the account", async () => {
    vi.mocked(ipc.githubAccount).mockResolvedValue(acct);
    await useGithubStore.getState().refresh();
    expect(useGithubStore.getState().account).toEqual(acct);
  });

  it("refresh records an error", async () => {
    vi.mocked(ipc.githubAccount).mockRejectedValue(new Error("boom"));
    await useGithubStore.getState().refresh();
    expect(useGithubStore.getState().error).toBe("boom");
  });

  it("login happy path", async () => {
    vi.mocked(ipc.githubLoginStart).mockResolvedValue(device);
    vi.mocked(ipc.githubLoginWait).mockResolvedValue(acct);
    await useGithubStore.getState().startLogin(true);
    expect(ipc.githubLoginStart).toHaveBeenCalledWith(true);
    expect(useGithubStore.getState().account).toEqual(acct);
    expect(useGithubStore.getState().login).toEqual({ step: "done" });
  });

  it("cancelled goes idle", async () => {
    vi.mocked(ipc.githubLoginStart).mockResolvedValue(device);
    vi.mocked(ipc.githubLoginWait).mockRejectedValue(
      new IpcError({ code: "github.cancelled", message: "cancelled" }),
    );
    await useGithubStore.getState().startLogin(false);
    expect(useGithubStore.getState().login).toEqual({ step: "idle" });
  });

  it("no_login goes idle without an error", async () => {
    vi.mocked(ipc.githubLoginStart).mockResolvedValue(device);
    vi.mocked(ipc.githubLoginWait).mockRejectedValue(
      new IpcError({ code: "github.no_login", message: "none" }),
    );
    await useGithubStore.getState().startLogin(false);
    expect(useGithubStore.getState().login).toEqual({ step: "idle" });
  });

  it("cancel during starting sticks and cancels the backend", async () => {
    let resolve!: (v: typeof device) => void;
    vi.mocked(ipc.githubLoginStart).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    vi.mocked(ipc.githubLoginCancel).mockResolvedValue();
    const started = useGithubStore.getState().startLogin(false);
    await useGithubStore.getState().cancelLogin();
    resolve(device);
    await started;
    expect(useGithubStore.getState().login).toEqual({ step: "idle" });
    expect(ipc.githubLoginCancel).toHaveBeenCalledTimes(2);
    expect(ipc.githubLoginWait).not.toHaveBeenCalled();
  });

  it("denied becomes an error", async () => {
    vi.mocked(ipc.githubLoginStart).mockResolvedValue(device);
    vi.mocked(ipc.githubLoginWait).mockRejectedValue(
      new IpcError({ code: "github.denied", message: "denied" }),
    );
    await useGithubStore.getState().startLogin(false);
    expect(useGithubStore.getState().login).toEqual({
      step: "error",
      message: "denied",
      code: "github.denied",
    });
  });

  it("logout clears the account", async () => {
    useGithubStore.setState({ account: acct });
    vi.mocked(ipc.githubLogout).mockResolvedValue();
    await useGithubStore.getState().logout();
    expect(useGithubStore.getState().account).toBeNull();
  });

  describe("repos", () => {
    const repo = { id: 1, name: "r", fullName: "octo/r", owner: "octo" } as GithubRepo;

    it("loads and caches", async () => {
      vi.mocked(ipc.githubRepos).mockResolvedValue([repo]);
      await useGithubStore.getState().loadRepos();
      await useGithubStore.getState().loadRepos();
      expect(useGithubStore.getState().repos).toEqual([repo]);
      expect(ipc.githubRepos).toHaveBeenCalledTimes(1);
    });

    it("force reloads", async () => {
      vi.mocked(ipc.githubRepos).mockResolvedValue([repo]);
      await useGithubStore.getState().loadRepos();
      await useGithubStore.getState().loadRepos(true);
      expect(ipc.githubRepos).toHaveBeenCalledTimes(2);
    });

    it("records an error", async () => {
      vi.mocked(ipc.githubRepos).mockRejectedValue(new Error("boom"));
      await useGithubStore.getState().loadRepos();
      const st = useGithubStore.getState();
      expect(st.reposError).toBe("boom");
      expect(st.repos).toBeNull();
      expect(st.reposLoading).toBe(false);
    });

    it("is cleared on logout", async () => {
      vi.mocked(ipc.githubLogout).mockResolvedValue();
      useGithubStore.setState({ repos: [repo] });
      await useGithubStore.getState().logout();
      expect(useGithubStore.getState().repos).toBeNull();
    });
  });
});

describe("problem tracking", () => {
  it("noteError classifies and loads the status", async () => {
    const status = { online: false, rateLimit: null, rateLimitedUntil: null };
    vi.mocked(ipc.githubStatus).mockResolvedValue(status);
    useGithubStore.getState().noteError(new IpcError({ code: "github.network", message: "down" }));
    expect(useGithubStore.getState().problem).toEqual({ kind: "offline" });
    await vi.waitFor(() => expect(useGithubStore.getState().status).toEqual(status));
  });

  it("noteError swallows status failures", async () => {
    useGithubStore.setState({ status: null });
    vi.mocked(ipc.githubStatus).mockRejectedValue(new Error("x"));
    useGithubStore.getState().noteError(new Error("boom"));
    await useGithubStore.getState().loadStatus();
    expect(useGithubStore.getState().problem).toEqual({ kind: "other", message: "boom" });
    expect(useGithubStore.getState().status).toBeNull();
  });

  it("noteSuccess clears the problem and marks online", () => {
    useGithubStore.setState({
      problem: { kind: "offline" },
      status: { online: false, rateLimit: null, rateLimitedUntil: null },
    });
    useGithubStore.getState().noteSuccess();
    expect(useGithubStore.getState().problem).toBeNull();
    expect(useGithubStore.getState().status?.online).toBe(true);
  });
});
