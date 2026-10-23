import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubAccount, GithubRepoSlug } from "../../ipc/github";
import type { Ref, RepoId } from "../../ipc/types";
import { EMPTY_GRAPH, useGraphStore } from "../../state/graph";
import { useGithubStore } from "../../state/github";
import { useOpsStore } from "../../state/ops";
import { EMPTY_PULLS, usePullsStore } from "../../state/pulls";
import { useUiStore } from "../../state/ui";
import { useWorktreesStore } from "../../state/worktrees";
import { Sidebar } from "./Sidebar";

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

const local = (name: string, over: Partial<Ref> = {}): Ref => ({
  name,
  fullName: `refs/heads/${name}`,
  kind: "localBranch",
  target: `oid-${name}`,
  upstream: null,
  isHead: false,
  ...over,
});
const remote = (r: string, name: string): Ref => ({
  name: `${r}/${name}`,
  fullName: `refs/remotes/${r}/${name}`,
  kind: { remoteBranch: { remote: r } },
  target: `oid-${r}-${name}`,
  upstream: null,
  isHead: false,
});

const REFS: Ref[] = [
  local("main", {
    isHead: true,
    upstream: { name: "origin/main", ahead: 2, behind: 3, gone: false },
  }),
  local("feature/login/form"),
  local("fix"),
  remote("origin", "main"),
  remote("origin", "dev"),
  remote("up", "x"),
];

function setup(): void {
  useGraphStore.setState({
    selectedOid: null,
    hoverOid: null,
    byRepo: {
      [id]: {
        ...EMPTY_GRAPH,
        refs: { head: { oid: "oid-main", branch: "main", detached: false }, refs: REFS },
      },
    },
  });
  useWorktreesStore.setState({ byRepo: { [id]: [] } });
  useGithubStore.setState({ account });
  usePullsStore.setState({
    byRepo: { [id]: { ...EMPTY_PULLS, slug, pulls: [], loaded: true } },
  });
  render(<Sidebar repoId={id} />);
}

function section(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

function treeRow(name: string): HTMLElement {
  return within(section("Local")).getByText(name).closest<HTMLElement>("[role=treeitem]")!;
}

const originalCheckout = useOpsStore.getState().checkout;

describe("Sidebar", () => {
  afterEach(() => useOpsStore.setState({ checkout: originalCheckout }));
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders the four sections with counts", () => {
    setup();
    for (const t of ["Local", "Remote", "Worktrees", "Pull requests"]) {
      expect(within(section(t)).getByText(t)).toBeTruthy();
    }
    const toggle = (t: string): HTMLElement =>
      within(section(t)).getByRole("button", { name: new RegExp(`^${t}`) });
    expect(toggle("Local")).toHaveTextContent("Local3");
    expect(toggle("Remote")).toHaveTextContent("Remote3");
    expect(toggle("Worktrees")).toHaveTextContent("Worktrees0");
  });

  it("collapse button closes the sidebar and the rail replaces the sections", () => {
    useUiStore.setState({ sidebarOpen: true });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(useUiStore.getState().sidebarOpen).toBe(false);
    expect(screen.queryByRole("region", { name: "Local" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Sidebar (collapsed)" })).toBeTruthy();
    useUiStore.setState({ sidebarOpen: true });
  });

  it("marks HEAD and shows ahead/behind badges", () => {
    setup();
    const row = treeRow("main");
    expect(within(row).getByTestId("head-check")).toBeTruthy();
    expect(within(row).getByTitle("2 ahead")).toHaveTextContent("2");
    expect(within(row).getByTitle("3 behind")).toHaveTextContent("3");
  });

  it("filter narrows the tree and auto-expands nested matches", () => {
    setup();
    expect(screen.queryByText("form")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter sidebar" }), {
      target: { value: "login" },
    });
    expect(within(section("Local")).getByText("form")).toBeTruthy();
    expect(within(section("Local")).queryByText("fix")).toBeNull();
    expect(within(section("Local")).getByRole("button", { name: /^Local/ })).toHaveTextContent(
      "Local1",
    );
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Filter sidebar" }), {
      key: "Escape",
    });
    expect(screen.getByRole("searchbox", { name: "Filter sidebar" })).toHaveValue("");
  });

  it("click selects the target, hover highlights it", () => {
    setup();
    const row = treeRow("fix");
    fireEvent.mouseEnter(row);
    expect(useGraphStore.getState().hoverOid).toBe("oid-fix");
    fireEvent.mouseLeave(row);
    expect(useGraphStore.getState().hoverOid).toBeNull();
    fireEvent.click(row);
    expect(useGraphStore.getState().selectedOid).toBe("oid-fix");
  });

  it("double-click checks out; remote branches use the tracking name", () => {
    const checkout = vi.fn().mockResolvedValue(true);
    setup();
    useOpsStore.setState({ checkout });
    const fix = treeRow("fix");
    fireEvent.doubleClick(fix);
    expect(checkout).toHaveBeenCalledWith(id, "fix");
    fireEvent.click(within(section("Remote")).getByText("up"));
    fireEvent.doubleClick(within(section("Remote")).getByText("x"));
    expect(checkout).toHaveBeenLastCalledWith(id, "up/x");
  });

  it("double-click on the current branch does nothing", () => {
    const checkout = vi.fn().mockResolvedValue(true);
    setup();
    useOpsStore.setState({ checkout });
    fireEvent.doubleClick(within(section("Local")).getByText("main"));
    expect(checkout).not.toHaveBeenCalled();
  });

  it("clears hover when the hovered row unmounts", () => {
    setup();
    fireEvent.mouseEnter(treeRow("fix"));
    expect(useGraphStore.getState().hoverOid).toBe("oid-fix");
    cleanup();
    expect(useGraphStore.getState().hoverOid).toBeNull();
  });

  it("remote filter matches the remote name and the tracking name", () => {
    setup();
    const box = screen.getByRole("searchbox", { name: "Filter sidebar" });
    fireEvent.change(box, { target: { value: "up" } });
    // "up" is the remote name: the whole group shows.
    expect(within(section("Remote")).getByText("x")).toBeTruthy();
    fireEvent.change(box, { target: { value: "origin/dev" } });
    const remoteSection = section("Remote");
    expect(within(remoteSection).getByText("dev")).toBeTruthy();
    expect(within(remoteSection).queryByText("main")).toBeNull();
    expect(within(remoteSection).queryByText("up")).toBeNull();
  });

  it("keyboard: roving tabindex, arrows, Enter checks out, Space selects", () => {
    const checkout = vi.fn().mockResolvedValue(true);
    setup();
    useOpsStore.setState({ checkout });
    const tree = within(section("Local")).getByRole("tree");
    const rows = (): HTMLElement[] => within(tree).getAllByRole("treeitem");
    // Folder "feature" first, then leaves fix, main.
    expect(rows().map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    rows()[0]!.focus();
    fireEvent.keyDown(rows()[0]!, { key: "ArrowRight" });
    expect(rows()[0]).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(rows()[0]!, { key: "ArrowDown" });
    const login = rows()[1]!;
    expect(document.activeElement).toBe(login);
    expect(login).toHaveAttribute("aria-level", "2");
    fireEvent.keyDown(login, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(rows()[0]);
    fireEvent.keyDown(rows()[0]!, { key: "End" });
    const last = rows()[rows().length - 1]!;
    expect(document.activeElement).toBe(last);
    expect(rows().filter((r) => r.tabIndex === 0)).toEqual([last]);
    fireEvent.keyDown(last, { key: " " });
    expect(useGraphStore.getState().selectedOid).toBe("oid-main");
    fireEvent.keyDown(rows()[rows().length - 2]!, { key: "Enter" });
    expect(checkout).toHaveBeenCalledWith(id, "fix");
  });

  it("shows No matches when the filter hides everything", () => {
    setup();
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter sidebar" }), {
      target: { value: "zzzz" },
    });
    expect(within(section("Local")).getByText("No matches")).toBeTruthy();
    expect(within(section("Remote")).getByText("No matches")).toBeTruthy();
  });
});
