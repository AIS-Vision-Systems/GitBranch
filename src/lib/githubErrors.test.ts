import { describe, expect, it } from "vitest";
import { IpcError } from "../ipc/core";
import { classifyGithubError, describeProblem, formatClock } from "./githubErrors";

const err = (code: string, detail?: string) =>
  new IpcError({ code, message: `msg ${code}`, ...(detail !== undefined ? { detail } : {}) });

describe("classifyGithubError", () => {
  it("maps codes", () => {
    expect(classifyGithubError(err("github.network"))).toEqual({ kind: "offline" });
    expect(classifyGithubError(err("github.unauthorized"))).toEqual({ kind: "signedOut" });
    expect(classifyGithubError(err("github.rate_limit", "1700000000"))).toEqual({
      kind: "rateLimited",
      resetAt: 1700000000,
    });
  });
  it("tolerates missing or bad detail", () => {
    expect(classifyGithubError(err("github.rate_limit"))).toEqual({
      kind: "rateLimited",
      resetAt: null,
    });
    expect(classifyGithubError(err("github.rate_limit", "soon"))).toEqual({
      kind: "rateLimited",
      resetAt: null,
    });
  });
  it("falls back to other", () => {
    expect(classifyGithubError(err("github.http"))).toEqual({
      kind: "other",
      message: "msg github.http",
    });
    expect(classifyGithubError(new Error("boom"))).toEqual({ kind: "other", message: "boom" });
    expect(classifyGithubError("x")).toEqual({ kind: "other", message: "x" });
  });
});

describe("describeProblem", () => {
  it("describes each kind", () => {
    expect(describeProblem({ kind: "offline" })).toBe("GitHub is unreachable. Working offline.");
    expect(describeProblem({ kind: "signedOut" })).toBe("Signed out of GitHub.");
    expect(describeProblem({ kind: "other", message: "m" })).toBe("m");
  });
  it("rate limit shows time and minutes", () => {
    const reset = 1700000000;
    const now = (reset - 600) * 1000;
    expect(describeProblem({ kind: "rateLimited", resetAt: reset }, now)).toBe(
      `GitHub API rate limit reached. Resets at ${formatClock(reset)} (in 10 min).`,
    );
    expect(describeProblem({ kind: "rateLimited", resetAt: null })).toBe(
      "GitHub API rate limit reached.",
    );
  });
});

describe("describeProblem after the window", () => {
  it("drops the stale reset time", () => {
    expect(describeProblem({ kind: "rateLimited", resetAt: 100 }, 200_000)).toBe(
      "GitHub API rate limit window ended. Retry now.",
    );
  });
});
