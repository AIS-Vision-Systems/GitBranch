import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { GithubAccount } from "../../ipc/github";
import { useGithubStore } from "../../state/github";
import { AccountMenu } from "./AccountMenu";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../../ipc/github", () => ({
  GITHUB_REVOKE_URL: "https://example.test/revoke",
  githubAccount: vi.fn(),
  githubLogout: vi.fn(),
}));

const acct: GithubAccount = {
  user: { login: "octo", name: "Octo Cat", avatarUrl: null, htmlUrl: "https://github.com/octo" },
  scopes: ["repo", "read:user"],
  offline: false,
};

const noopRefresh = (): Promise<void> => Promise.resolve();

beforeEach(() => {
  useGithubStore.setState({ account: null, refresh: noopRefresh });
});

describe("AccountMenu", () => {
  it("shows sign in when signed out", () => {
    render(<AccountMenu />);
    expect(screen.getByRole("button", { name: "Sign in to GitHub" })).toBeInTheDocument();
  });

  it("shows the account popover and signs out", () => {
    const logout = vi.fn(() => Promise.resolve());
    useGithubStore.setState({ account: acct, logout });
    render(<AccountMenu />);
    fireEvent.click(screen.getByRole("button", { name: /octo/ }));
    expect(screen.getByText("Octo Cat")).toBeInTheDocument();
    expect(screen.getByText("repo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(logout).toHaveBeenCalledOnce();
    expect(screen.queryByText("Octo Cat")).toBeNull();
  });
});
