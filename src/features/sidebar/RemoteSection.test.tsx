import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ref, RepoId } from "../../ipc/types";
import { useDialogsStore } from "../../state/dialogs";
import { EMPTY_GRAPH, useGraphStore } from "../../state/graph";
import { useOpsStore } from "../../state/ops";
import { useRemotesStore } from "../../state/remotes";
import { useUiStore } from "../../state/ui";
import { RemoteSection } from "./RemoteSection";
import { LocalSection } from "./LocalSection";

vi.mock("../../ipc/github", () => ({
  githubAvatar: vi.fn().mockResolvedValue("data:image/png;base64,AAAA"),
}));

const id = "r1" as RepoId;
const remoteRef = (r: string, name: string): Ref => ({
  name: `${r}/${name}`,
  fullName: `refs/remotes/${r}/${name}`,
  kind: { remoteBranch: { remote: r } },
  target: `oid-${r}-${name}`,
  upstream: null,
  isHead: false,
});
const localRef = (name: string, isHead = false): Ref => ({
  name,
  fullName: `refs/heads/${name}`,
  kind: "localBranch",
  target: `oid-${name}`,
  upstream: null,
  isHead,
});

const writeText = vi.fn().mockResolvedValue(undefined);
const removeRemote = vi.fn().mockResolvedValue(true);

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  useOpsStore.setState({ removeRemote });
  useDialogsStore.getState().close();
  useUiStore.setState({ toasts: [] });
  useRemotesStore.setState({
    byRepo: {
      [id]: [
        { name: "origin", fetchUrl: "https://github.com/octo/repo.git", pushUrl: null },
        { name: "other", fetchUrl: "https://example.com/x.git", pushUrl: null },
      ],
    },
  });
  useGraphStore.setState({
    selectedOid: null,
    hoverOid: null,
    byRepo: {
      [id]: {
        ...EMPTY_GRAPH,
        refs: {
          head: { oid: "oid-main", branch: "main", detached: false },
          refs: [localRef("main", true), localRef("feature/x"), remoteRef("origin", "main")],
        },
      },
    },
  });
});
afterEach(cleanup);

describe("branch rows", () => {
  it("leaf rows carry a branch icon, folders a folder icon", () => {
    const { container } = render(<LocalSection repoId={id} />);
    const main = screen.getByText("main").closest("[role=treeitem]")!;
    expect(main.querySelector("[data-icon=branch]")).not.toBeNull();
    expect(main.querySelector("[data-testid=head-check]")).not.toBeNull();
    const folder = screen.getByText("feature").closest("[role=treeitem]")!;
    expect(folder.querySelector("[data-icon=folder]")).not.toBeNull();
    expect(container.querySelectorAll("[data-icon=branch]")).toHaveLength(1);
  });
});

describe("remote rows", () => {
  const row = (name: string): HTMLElement =>
    screen.getByText(name).closest<HTMLElement>("[role=treeitem]")!;

  it("shows the owner avatar for GitHub remotes and a cloud otherwise", async () => {
    render(<RemoteSection repoId={id} />);
    await waitFor(() => expect(row("origin").querySelector("img")).not.toBeNull());
    expect(row("origin").querySelector("img")?.getAttribute("alt")).toBe("");
    expect(row("other").querySelector("[data-icon=remote]")).not.toBeNull();
  });

  it("right-click shows Edit / Copy link / Remove", () => {
    render(<RemoteSection repoId={id} />);
    fireEvent.contextMenu(row("origin"));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Edit origin…")).toBeTruthy();
    expect(within(menu).getByText("Copy link to remote: origin")).toBeTruthy();
    expect(within(menu).getByText("Remove origin")).toBeTruthy();
  });

  it("Shift+F10 opens the same menu", () => {
    render(<RemoteSection repoId={id} />);
    fireEvent.keyDown(row("origin"), { key: "F10", shiftKey: true });
    expect(screen.getByText("Edit origin…")).toBeTruthy();
  });

  it("Copy link writes the fetch URL and toasts", async () => {
    render(<RemoteSection repoId={id} />);
    fireEvent.contextMenu(row("origin"));
    fireEvent.click(screen.getByText("Copy link to remote: origin"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://github.com/octo/repo.git"));
    await waitFor(() => expect(useUiStore.getState().toasts).toHaveLength(1));
  });

  it("Copy link failure reports an error toast without throwing", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    render(<RemoteSection repoId={id} />);
    fireEvent.contextMenu(row("origin"));
    fireEvent.click(screen.getByText("Copy link to remote: origin"));
    await waitFor(() => expect(useUiStore.getState().toasts).toHaveLength(1));
    expect(useUiStore.getState().toasts[0]?.kind).toBe("error");
  });

  it("Edit opens the dialog and Remove calls removeRemote", () => {
    render(<RemoteSection repoId={id} />);
    fireEvent.contextMenu(row("origin"));
    fireEvent.click(screen.getByText("Edit origin…"));
    expect(useDialogsStore.getState().current).toMatchObject({
      kind: "custom",
      props: { repoId: id, name: "origin" },
    });
    fireEvent.contextMenu(row("origin"));
    fireEvent.click(screen.getByText("Remove origin"));
    expect(removeRemote).toHaveBeenCalledWith(id, "origin");
  });
});
