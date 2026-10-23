import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { githubAvatar, type GithubAccount } from "../../ipc/github";
import { gitIdentity, setGitIdentity } from "../../ipc/identity";
import { useGithubStore } from "../../state/github";
import { useReposStore } from "../../state/repos";
import { AccountMenu } from "./AccountMenu";
import { resetAvatarCache } from "./useAvatar";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../../ipc/github", () => ({
  GITHUB_REVOKE_URL: "https://example.test/revoke",
  githubAccount: vi.fn(),
  githubLogout: vi.fn(),
  githubAvatar: vi.fn(),
}));
vi.mock("../../ipc/identity", () => ({
  gitIdentity: vi.fn(),
  setGitIdentity: vi.fn(),
}));

const acct: GithubAccount = {
  user: {
    login: "octo",
    name: "Octo Cat",
    avatarUrl: null,
    htmlUrl: "https://github.com/octo",
    email: null,
  },
  scopes: ["repo", "read:user"],
  offline: false,
};

const noopRefresh = (): Promise<void> => Promise.resolve();

beforeEach(() => {
  vi.clearAllMocks();
  resetAvatarCache();
  vi.mocked(githubAvatar).mockResolvedValue(null);
  vi.mocked(gitIdentity).mockResolvedValue({
    name: { value: "Octo Cat", scope: "global" },
    email: { value: "octo@example.test", scope: "local" },
  });
  vi.mocked(setGitIdentity).mockResolvedValue(undefined);
  useGithubStore.setState({ account: null, refresh: noopRefresh });
  useReposStore.setState({ currentId: null });
});

function openPanel(): void {
  fireEvent.click(screen.getByRole("button", { name: /Account octo/ }));
}

describe("AccountMenu", () => {
  it("shows sign in when signed out", () => {
    render(<AccountMenu />);
    expect(screen.getByRole("button", { name: "Sign in to GitHub" })).toBeInTheDocument();
  });

  it("shows the account panel and signs out", () => {
    const logout = vi.fn(() => Promise.resolve());
    useGithubStore.setState({ account: acct, logout });
    render(<AccountMenu />);
    openPanel();
    expect(screen.getAllByText("Octo Cat").length).toBeGreaterThan(0);
    expect(screen.getByText("repo")).toBeInTheDocument();
    expect(screen.getByText("not public")).toBeInTheDocument();
    for (const name of ["Manage account", "Re-authorize…", "Sign out", "Revoke on GitHub…"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(logout).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the avatar image from the data URL", async () => {
    vi.mocked(githubAvatar).mockResolvedValue("data:image/png;base64,AAAA");
    useGithubStore.setState({ account: acct });
    render(<AccountMenu />);
    expect(screen.getByTestId("github-avatar-fallback")).toHaveTextContent("OC");
    const img = await screen.findByTestId("github-avatar");
    expect(img).toHaveAttribute("src", "data:image/png;base64,AAAA");
    expect(githubAvatar).toHaveBeenCalledTimes(1);
    expect(githubAvatar).toHaveBeenCalledWith("octo");
  });

  it("keeps the initials when there is no avatar", async () => {
    useGithubStore.setState({ account: acct });
    render(<AccountMenu />);
    await waitFor(() => expect(githubAvatar).toHaveBeenCalled());
    expect(screen.getByTestId("github-avatar-fallback")).toBeInTheDocument();
    expect(screen.queryByTestId("github-avatar")).toBeNull();
  });

  it("hides the commit signature without an open repo", () => {
    useGithubStore.setState({ account: acct });
    render(<AccountMenu />);
    openPanel();
    expect(screen.queryByText("Commit signature")).toBeNull();
    expect(gitIdentity).not.toHaveBeenCalled();
  });

  it("shows the commit signature with scope tags", async () => {
    useGithubStore.setState({ account: acct });
    useReposStore.setState({ currentId: "r1" });
    render(<AccountMenu />);
    openPanel();
    expect(await screen.findByText("octo@example.test")).toBeInTheDocument();
    expect(gitIdentity).toHaveBeenCalledWith("r1");
    expect(screen.getByText("global")).toBeInTheDocument();
    expect(screen.getByText("local")).toBeInTheDocument();
  });

  it("edits the identity and saves with the chosen scope", async () => {
    useGithubStore.setState({ account: acct });
    useReposStore.setState({ currentId: "r1" });
    render(<AccountMenu />);
    openPanel();
    await screen.findByText("octo@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("radio", { name: /Globally/ })).toBeChecked();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New Name" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(setGitIdentity).toHaveBeenCalledWith("r1", "global", "New Name", "new@example.test"),
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).toBeNull());
    // Panel load, identity store refresh, panel reload.
    expect(gitIdentity).toHaveBeenCalledTimes(3);
  });

  it("saves locally when This repository is chosen", async () => {
    useGithubStore.setState({ account: acct });
    useReposStore.setState({ currentId: "r1" });
    render(<AccountMenu />);
    openPanel();
    await screen.findByText("octo@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("radio", { name: /This repository/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(setGitIdentity).toHaveBeenCalledWith("r1", "local", "Octo Cat", "octo@example.test"),
    );
  });
});
