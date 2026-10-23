import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubAccount, GithubRepoSlug } from "../../ipc/github";
import type { Ref, RepoId } from "../../ipc/types";
import { EMPTY_GRAPH, useGraphStore } from "../../state/graph";
import { useGithubStore } from "../../state/github";
import { EMPTY_PULLS, usePullsStore } from "../../state/pulls";
import { useUiStore } from "../../state/ui";
import { useWorktreesStore } from "../../state/worktrees";
import { Sidebar } from "./Sidebar";
import { SidebarRail } from "./SidebarRail";

vi.mock("../../ipc/github", () => ({
  githubRepoSlug: vi.fn(),
  githubPulls: vi.fn(),
  githubPull: vi.fn(),
  githubCheckoutPull: vi.fn(),
}));
vi.mock("../../ipc/worktree", () => ({}));

const id = "r1" as RepoId;
const slug: GithubRepoSlug = { remote: "origin", owner: "o", name: "r" };
const account = { user: { login: "me" }, scopes: [], offline: false } as unknown as GithubAccount;

const local = (name: string): Ref => ({
  name,
  fullName: `refs/heads/${name}`,
  kind: "localBranch",
  target: `oid-${name}`,
  upstream: null,
  isHead: false,
});
const remote = (name: string): Ref => ({
  name: `origin/${name}`,
  fullName: `refs/remotes/origin/${name}`,
  kind: { remoteBranch: { remote: "origin" } },
  target: `oid-${name}`,
  upstream: null,
  isHead: false,
});

const scrollIntoView = vi.fn();

beforeEach(() => {
  localStorage.clear();
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
  useUiStore.setState({
    sidebarOpen: false,
    sidebarSections: { worktrees: false },
    pendingSidebarScroll: null,
  });
  useGraphStore.setState({
    byRepo: {
      [id]: {
        ...EMPTY_GRAPH,
        refs: {
          head: { oid: "oid-a", branch: "a", detached: false },
          refs: [local("a"), local("b"), remote("a")],
        },
      },
    },
  });
  useWorktreesStore.setState({ byRepo: { [id]: [] } });
  useGithubStore.setState({ account });
  usePullsStore.setState({ byRepo: { [id]: { ...EMPTY_PULLS, slug, pulls: [], loaded: true } } });
});

afterEach(() => {
  cleanup();
  useUiStore.setState({ sidebarOpen: true, sidebarSections: {} });
});

describe("SidebarRail", () => {
  it("shows one button per section with its count", () => {
    render(<SidebarRail repoId={id} />);
    expect(screen.getByRole("navigation", { name: "Sidebar (collapsed)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Local (2)" })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Remote (1)" })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Worktrees (0)" })).toHaveTextContent("0");
    expect(screen.getByRole("button", { name: "Pull requests (0)" })).toHaveTextContent("0");
  });

  it("expand button opens the sidebar", () => {
    render(<SidebarRail repoId={id} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(useUiStore.getState().sidebarOpen).toBe(true);
  });

  it("clicking a section icon expands, opens the section and scrolls to it", () => {
    render(<Sidebar repoId={id} />);
    fireEvent.click(screen.getByRole("button", { name: "Worktrees (0)" }));
    const ui = useUiStore.getState();
    expect(ui.sidebarOpen).toBe(true);
    expect(ui.sidebarSections["worktrees"]).toBe(true);
    expect(screen.getByRole("region", { name: "Worktrees" })).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(scrollIntoView.mock.contexts[0]).toBe(
      document.querySelector('[data-section="worktrees"]'),
    );
    expect(ui.pendingSidebarScroll).toBeNull();
  });
});
