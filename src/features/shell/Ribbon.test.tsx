import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/conflict", () => ({ openTerminal: vi.fn().mockResolvedValue(undefined) }));

import { openTerminal } from "../../ipc/conflict";
import type { InProgress } from "../../ipc/merge";
import type { UndoInfo } from "../../ipc/reflog";
import type { OpenedRepo, Ref, RepoId } from "../../ipc/types";
import { useDialogsStore } from "../../state/dialogs";
import { EMPTY_GRAPH, useGraphStore } from "../../state/graph";
import { useOpsStore } from "../../state/ops";
import { useReposStore } from "../../state/repos";
import { useRemotesStore } from "../../state/remotes";
import { Ribbon } from "./Ribbon";

const id = "r1" as RepoId;
const info: UndoInfo = {
  label: "commit: add thing",
  action: { kind: "resetSoft", target: "a".repeat(40) },
};
const undoLast = vi.fn().mockResolvedValue(true);
const redoLast = vi.fn().mockResolvedValue(true);
const fetch = vi.fn().mockResolvedValue(true);
const pull = vi.fn().mockResolvedValue(true);
const checkout = vi.fn().mockResolvedValue(true);

const branch = (name: string, isHead: boolean): Ref => ({
  name,
  fullName: `refs/heads/${name}`,
  kind: "localBranch",
  target: "a".repeat(40),
  upstream: isHead ? { name: `origin/${name}`, ahead: 2, behind: 1, gone: false } : null,
  isHead,
});

const repo = (repoId: string, name: string): OpenedRepo => ({
  repoId: repoId as RepoId,
  name,
  path: `/${name}`,
  gitDir: `/${name}/.git`,
  isWorktree: false,
  mainWorkTree: null,
  isBare: false,
});

function setup(undo: UndoInfo | null, inProgress: InProgress | null = null) {
  useGraphStore.setState({
    byRepo: {
      [id]: {
        ...EMPTY_GRAPH,
        undo,
        inProgress,
        refs: {
          head: { oid: "a".repeat(40), branch: "main", detached: false },
          refs: [branch("main", true), branch("feature", false)],
        },
      },
    },
  });
  return render(
    <div>
      <textarea aria-label="msg" />
      <Ribbon repoId={id} />
    </div>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useOpsStore.setState({ undoLast, redoLast, fetch, pull, checkout, busy: false, redo: {} });
  useDialogsStore.setState({ current: null, busy: false });
  useRemotesStore.setState({
    byRepo: { [id]: [{ name: "origin", fetchUrl: "u", pushUrl: null }] },
  });
  useReposStore.setState({
    open: [repo("r1", "alpha"), repo("r2", "beta")],
    currentId: "r1",
  });
});

describe("Ribbon layout", () => {
  it("renders all groups and buttons", () => {
    setup(info);
    for (const g of ["Navigate", "Actions", "More"]) {
      expect(screen.getByRole("group", { name: g })).toBeInTheDocument();
    }
    for (const n of [
      "Repository",
      "Branch picker",
      "Undo",
      "Redo",
      "Fetch",
      "Fetch options",
      "Push",
      "Branch",
      "Stash",
      "Pop",
      "Terminal",
      "More actions",
      "Search",
    ]) {
      expect(screen.getByRole("button", { name: n })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Branch picker" })).toHaveTextContent("main");
    expect(screen.getByRole("button", { name: "Branch picker" })).toHaveTextContent("↑2 ↓1");
  });
});

describe("Ribbon undo/redo", () => {
  it("undo is disabled with a tooltip when nothing to undo", () => {
    setup(null);
    const b = screen.getByRole("button", { name: "Undo" });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("title", "Nothing to undo");
  });

  it("undo click and Ctrl+Z call undoLast; not inside a textarea", () => {
    setup(info);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undoLast).toHaveBeenCalledWith(id, info);
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(undoLast).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByLabelText("msg"), { key: "z", ctrlKey: true });
    expect(undoLast).toHaveBeenCalledTimes(2);
  });

  it("undo is disabled while an operation is in progress", () => {
    setup(info, { kind: "rebase", headName: "x", onto: null, done: 1, total: 3 });
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(undoLast).not.toHaveBeenCalled();
  });

  it("redo is disabled without a redo target", () => {
    setup(info);
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    fireEvent.keyDown(document.body, { key: "y", ctrlKey: true });
    expect(redoLast).not.toHaveBeenCalled();
  });

  it("redo click and Ctrl+Y call redoLast", () => {
    useOpsStore.setState({
      redo: {
        [id]: {
          action: { kind: "resetSoft", target: "c".repeat(40) },
          head: "a".repeat(40),
          branch: "main",
        },
      },
    });
    setup(null);
    const b = screen.getByRole("button", { name: "Redo" });
    expect(b).toBeEnabled();
    fireEvent.click(b);
    expect(redoLast).toHaveBeenCalledWith(id);
    fireEvent.keyDown(document.body, { key: "y", ctrlKey: true });
    expect(redoLast).toHaveBeenCalledTimes(2);
  });
});

describe("Ribbon fetch menu", () => {
  it("main click fetches all remotes", () => {
    setup(null);
    fireEvent.click(screen.getByRole("button", { name: "Fetch" }));
    expect(fetch).toHaveBeenCalledWith(id, { remote: null, prune: true, tags: false });
  });

  it("caret menu dispatches fetch and pull strategies", () => {
    setup(null);
    const run = (name: string): void => {
      fireEvent.click(screen.getByRole("button", { name: "Fetch options" }));
      fireEvent.click(screen.getByRole("menuitem", { name: (n) => n.startsWith(name) }));
    };
    run("Pull (fast-forward)");
    expect(pull).toHaveBeenLastCalledWith(id, { remote: null, branch: null, mode: "ffOnly" });
    run("Pull (rebase)");
    expect(pull).toHaveBeenLastCalledWith(id, { remote: null, branch: null, mode: "rebase" });
    run("Pull (merge)");
    expect(pull).toHaveBeenLastCalledWith(id, { remote: null, branch: null, mode: "merge" });
    run("Fetch all");
    expect(fetch).toHaveBeenLastCalledWith(id, { remote: null, prune: true, tags: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("Ribbon misc", () => {
  it("Terminal calls openTerminal", () => {
    setup(null);
    fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
    expect(openTerminal).toHaveBeenCalledWith(id);
  });

  it("branch dropdown lists, filters and checks out a branch", () => {
    setup(null);
    fireEvent.click(screen.getByRole("button", { name: "Branch picker" }));
    expect(screen.getByRole("button", { name: /^feature/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter branches"), { target: { value: "zzz" } });
    expect(screen.getByText("No matching branches")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter branches"), { target: { value: "feat" } });
    fireEvent.click(screen.getByRole("button", { name: /^feature/ }));
    expect(checkout).toHaveBeenCalledWith(id, "feature");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Esc closes the branch dropdown", () => {
    setup(null);
    fireEvent.click(screen.getByRole("button", { name: "Branch picker" }));
    fireEvent.keyDown(screen.getByLabelText("Filter branches"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("repository dropdown switches tabs", () => {
    setup(null);
    fireEvent.click(screen.getByRole("button", { name: "Repository" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "beta" }));
    expect(useReposStore.getState().currentId).toBe("r2");
  });

  it("Pop is disabled without stashes", () => {
    setup(null);
    expect(screen.getByRole("button", { name: "Pop" })).toBeDisabled();
  });
});
