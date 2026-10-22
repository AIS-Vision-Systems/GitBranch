import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { GithubAccount, GithubRepo } from "../../ipc/github";
import { useGithubStore } from "../../state/github";
import { openClone, openGithubLogin } from "../dialogs/open";
import { RepoPickerDialog } from "./RepoPickerDialog";

vi.mock("../../ipc/github", () => ({ githubRepos: vi.fn() }));
vi.mock("../dialogs/open", () => ({ openClone: vi.fn(), openGithubLogin: vi.fn() }));

const acct: GithubAccount = {
  user: { login: "octo", name: null, avatarUrl: null, htmlUrl: "https://github.com/octo" },
  scopes: ["repo"],
  offline: false,
};

const mk = (
  id: number,
  owner: string,
  name: string,
  extra: Partial<GithubRepo> = {},
): GithubRepo => ({
  id,
  name,
  fullName: `${owner}/${name}`,
  owner,
  private: false,
  fork: false,
  archived: false,
  description: null,
  htmlUrl: `https://github.com/${owner}/${name}`,
  cloneUrl: `https://github.com/${owner}/${name}.git`,
  sshUrl: `git@github.com:${owner}/${name}.git`,
  defaultBranch: "main",
  pushedAt: null,
  language: null,
  ...extra,
});

const repos = [
  mk(1, "octo", "alpha", { private: true, description: "First thing" }),
  mk(2, "acme", "beta"),
  mk(3, "acme", "old", { archived: true }),
];
const rows = (): HTMLElement[] => within(screen.getByRole("listbox")).getAllByRole("option");
const noop = (): Promise<void> => Promise.resolve();

beforeEach(() => {
  vi.clearAllMocks();
  useGithubStore.setState({
    account: acct,
    repos,
    reposLoading: false,
    reposError: null,
    loadRepos: noop,
  });
});

describe("RepoPickerDialog", () => {
  it("shows sign in when signed out", () => {
    useGithubStore.setState({ account: null });
    const onClose = vi.fn();
    render(<RepoPickerDialog onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in to GitHub" }));
    expect(onClose).toHaveBeenCalled();
    expect(openGithubLogin).toHaveBeenCalled();
  });

  it("lists repos, hiding archived by default", () => {
    render(<RepoPickerDialog onClose={vi.fn()} />);
    expect(rows()).toHaveLength(2);
    fireEvent.click(screen.getByLabelText("Show archived"));
    expect(rows()).toHaveLength(3);
  });

  it("filters by search", () => {
    render(<RepoPickerDialog onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search repositories"), { target: { value: "FIRST" } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });

  it("chooses the selected row with the keyboard", () => {
    const onClose = vi.fn();
    render(<RepoPickerDialog onClose={onClose} />);
    const search = screen.getByLabelText("Search repositories");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onClose).toHaveBeenCalled();
    expect(openClone).toHaveBeenCalledWith({
      url: "https://github.com/acme/beta.git",
      defaultBranch: "main",
    });
  });

  it("Clone button opens the clone dialog for the clicked row", () => {
    render(<RepoPickerDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("beta"));
    fireEvent.click(screen.getByRole("button", { name: "Clone" }));
    expect(openClone).toHaveBeenCalledWith({
      url: "https://github.com/acme/beta.git",
      defaultBranch: "main",
    });
  });
});
