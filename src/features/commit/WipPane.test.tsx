import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusEntry } from "../../ipc/types";
import type { RepoId } from "../../ipc/types";

vi.mock("../../ipc/commit", () => ({
  commit: vi.fn(),
  commitTemplate: vi.fn().mockResolvedValue(null),
  headMessage: vi.fn(),
}));
vi.mock("../../ipc/stage", () => ({
  stageFiles: vi.fn(),
  unstageFiles: vi.fn(),
  discardFiles: vi.fn(),
  stageAll: vi.fn(),
  unstageAll: vi.fn(),
  applyHunk: vi.fn(),
}));

import * as stageIpc from "../../ipc/stage";
import { useCommitFormStore } from "../../state/commitForm";
import { useDialogsStore } from "../../state/dialogs";
import { EMPTY_GRAPH, useGraphStore } from "../../state/graph";
import { useOpsStore } from "../../state/ops";
import { wipItems } from "./items";
import { WipPane } from "./WipPane";

const id = "r1" as RepoId;
const entry = (over: Partial<StatusEntry>): StatusEntry => ({
  path: "a",
  origPath: null,
  staged: "unmodified",
  unstaged: "unmodified",
  conflicted: false,
  submodule: false,
  ...over,
});

const entries: StatusEntry[] = [
  entry({ path: "s.ts", staged: "modified" }),
  entry({ path: "u.ts", unstaged: "modified" }),
  entry({ path: "n.ts", unstaged: "untracked" }),
  entry({ path: "c.ts", staged: "unmerged", unstaged: "unmerged", conflicted: true }),
];

function setup(es = entries) {
  return render(
    <WipPane repoId={id} items={wipItems(es)} selectedKey={null} onSelect={() => undefined} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useCommitFormStore.getState().reset();
  useDialogsStore.getState().close();
  useGraphStore.setState({ byRepo: {} });
});

describe("WipPane", () => {
  it("renders sections with counts", () => {
    setup();
    for (const [name, count] of [
      ["Staged files", "(1)"],
      ["Unstaged files", "(2)"],
      ["Conflicts", "(1)"],
    ] as const) {
      const sec = screen.getByRole("region", { name });
      expect(within(sec).getByRole("heading")).toHaveTextContent(`${name} ${count}`);
    }
  });

  it("always renders both sections, with placeholders and disabled bulk buttons when empty", () => {
    setup([]);
    expect(screen.getByRole("region", { name: "Staged files" })).toHaveTextContent(
      "No staged files",
    );
    expect(screen.getByRole("region", { name: "Unstaged files" })).toHaveTextContent(
      "No unstaged changes",
    );
    expect(screen.getByRole("button", { name: "Unstage all" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stage all" })).toBeDisabled();
    expect(screen.queryByRole("region", { name: "Conflicts" })).toBeNull();
  });

  it("lists untracked files under Unstaged files with a ? badge", () => {
    setup();
    const sec = screen.getByRole("region", { name: "Unstaged files" });
    expect(within(sec).getByTitle("n.ts")).toHaveTextContent("?");
    expect(screen.queryByRole("region", { name: "Untracked" })).toBeNull();
  });

  it("tree mode nests files under collapsible folders; flat mode lists paths", () => {
    localStorage.removeItem("gitbranch.wipTree");
    setup([entry({ path: "src/lib/x.ts", unstaged: "modified" })]);
    const dir = screen.getByTitle("src/lib");
    expect(dir).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTitle("src/lib/x.ts")).toBeInTheDocument();
    fireEvent.click(dir);
    expect(screen.queryByTitle("src/lib/x.ts")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Flat" }));
    expect(localStorage.getItem("gitbranch.wipTree")).toBe("false");
    expect(screen.getByTitle("src/lib/x.ts")).toBeInTheDocument();
    expect(screen.queryByTitle("src/lib")).toBeNull();
    localStorage.removeItem("gitbranch.wipTree");
  });

  it("row actions call the store", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Unstage s.ts" }));
    expect(stageIpc.unstageFiles).toHaveBeenCalledWith(id, ["s.ts"]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Stage n.ts" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Stage n.ts" }));
    expect(stageIpc.stageFiles).toHaveBeenCalledWith(id, ["n.ts"]);
  });

  it("discard opens a danger confirm", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Discard u.ts" }));
    const spec = useDialogsStore.getState().current;
    expect(spec).toMatchObject({ kind: "confirm", danger: true });
  });

  it("conflict buttons call the ops store with the path", () => {
    const takeSide = vi.fn().mockResolvedValue(true);
    const openInEditor = vi.fn().mockResolvedValue(true);
    const markResolved = vi.fn().mockResolvedValue(true);
    useOpsStore.setState({ takeSide, openInEditor, markResolved, busy: false });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Ours c.ts" }));
    expect(takeSide).toHaveBeenLastCalledWith(id, ["c.ts"], "ours");
    fireEvent.click(screen.getByRole("button", { name: "Theirs c.ts" }));
    expect(takeSide).toHaveBeenLastCalledWith(id, ["c.ts"], "theirs");
    fireEvent.click(screen.getByRole("button", { name: "Open c.ts" }));
    expect(openInEditor).toHaveBeenCalledWith(id, "c.ts");
    fireEvent.click(screen.getByRole("button", { name: "Mark resolved c.ts" }));
    expect(markResolved).toHaveBeenCalledWith(id, ["c.ts"]);
  });

  it("discard confirm shows the exact commands with quoted paths", () => {
    setup([
      entry({ path: "my file.ts", unstaged: "modified" }),
      entry({ path: "new dir/x.ts", unstaged: "untracked" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Discard my file.ts" }));
    const spec = useDialogsStore.getState().current;
    expect(spec).toMatchObject({
      command: 'git restore --worktree -- "my file.ts"',
    });
  });

  it("header buttons stage and unstage everything", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Unstage all" }));
    expect(stageIpc.unstageAll).toHaveBeenCalledWith(id);
    await waitFor(() => expect(screen.getByRole("button", { name: "Stage all" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Stage all" }));
    expect(stageIpc.stageAll).toHaveBeenCalledWith(id);
  });

  it("commit form gating and disabled Commit and push", () => {
    setup();
    const commit = screen.getByRole("button", { name: "Commit" });
    expect(commit).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Commit message"), { target: { value: "msg" } });
    expect(commit).toBeEnabled();
    expect(screen.getByRole("button", { name: "Commit and push" })).toBeDisabled();
  });

  it("commit needs staged files unless amending", () => {
    setup([entry({ path: "u.ts", unstaged: "modified" })]);
    fireEvent.change(screen.getByPlaceholderText("Commit message"), { target: { value: "msg" } });
    expect(screen.getByRole("button", { name: "Commit" })).toBeDisabled();
  });

  it("renders Conflicts first", () => {
    setup();
    const names = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(names[0]).toBe("Conflicts");
  });

  it("labels the side buttons by git's rebase naming during a rebase", () => {
    useGraphStore.setState({
      byRepo: {
        [id]: {
          ...EMPTY_GRAPH,
          inProgress: { kind: "rebase", headName: "feat", onto: "o", done: 1, total: 2 },
        },
      },
    });
    setup();
    const ours = screen.getByRole("button", { name: "Ours (onto) c.ts" });
    expect(ours).toHaveAttribute("title", expect.stringContaining("rebasing onto"));
    expect(screen.getByRole("button", { name: "Theirs (commit) c.ts" })).toHaveAttribute(
      "title",
      expect.stringContaining("replayed"),
    );
    expect(screen.queryByRole("button", { name: "Ours c.ts" })).toBeNull();
  });
});
