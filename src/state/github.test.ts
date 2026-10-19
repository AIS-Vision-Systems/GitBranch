import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ipc from "../ipc/github";
import type { GithubAccount } from "../ipc/github";
import { IpcError } from "../ipc/core";
import { useGithubStore } from "./github";

vi.mock("../ipc/github", () => ({
  githubAccount: vi.fn(),
  githubLoginStart: vi.fn(),
  githubLoginWait: vi.fn(),
  githubLoginCancel: vi.fn(),
  githubLogout: vi.fn(),
}));

const acct: GithubAccount = {
  user: { login: "octo", name: "Octo Cat", avatarUrl: null, htmlUrl: "https://github.com/octo" },
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
});
