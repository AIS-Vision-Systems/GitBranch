import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ref, RepoId, Status } from "../../ipc/types";
import { cleanStatus, commit, noRefs, row } from "../../test/graphFixtures";

vi.mock("../../ipc/graph", () => ({
  loadGraph: vi.fn(),
  listRefs: vi.fn(),
  repoStatus: vi.fn(),
}));

import { useDialogsStore } from "../../state/dialogs";
import { EMPTY_GRAPH, useGraphStore } from "../../state/graph";
import { GraphView } from "./GraphView";

const id = "r1" as RepoId;

beforeAll(() => {
  // jsdom has no layout: give elements a viewport so the virtualizer renders rows.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 240 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 800 });
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ width: 800, height: 240, top: 0, left: 0, right: 800, bottom: 240, x: 0, y: 0 }) as DOMRect;
});

function seed(n: number, status: Status = cleanStatus): void {
  const oids = Array.from({ length: n }, (_, i) => `c${i}`);
  useGraphStore.setState({
    byRepo: {
      [id]: {
        ...EMPTY_GRAPH,
        commits: oids.map((o) => commit(o)),
        rows: oids.map((o) => row(o)),
        byOid: new Map(oids.map((o, i) => [o, i])),
        refs: noRefs,
        status,
      },
    },
    selectedOid: null,
    hoverOid: null,
  });
}

beforeEach(() => {
  useGraphStore.setState({ byRepo: {}, selectedOid: null, hoverOid: null });
});

describe("GraphView", () => {
  it("renders only a window of rows", () => {
    seed(100);
    render(<GraphView repoId={id} />);
    const n = screen.getAllByRole("option").length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(100);
  });

  it("click selects a row", async () => {
    seed(5);
    render(<GraphView repoId={id} />);
    await userEvent.click(screen.getByText("commit c2"));
    expect(useGraphStore.getState().selectedOid).toBe("c2");
  });

  it("ArrowDown/ArrowUp/End/Home move the selection", () => {
    seed(5);
    render(<GraphView repoId={id} />);
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(useGraphStore.getState().selectedOid).toBe("c0");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(useGraphStore.getState().selectedOid).toBe("c1");
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(useGraphStore.getState().selectedOid).toBe("c0");
    fireEvent.keyDown(list, { key: "End" });
    expect(useGraphStore.getState().selectedOid).toBe("c4");
    fireEvent.keyDown(list, { key: "Home" });
    expect(useGraphStore.getState().selectedOid).toBe("c0");
  });

  it("shows a WIP row first when the tree is dirty and keyboard reaches it", () => {
    seed(3, {
      branch: null,
      entries: [
        {
          path: "a.txt",
          origPath: null,
          staged: "unmodified",
          unstaged: "modified",
          conflicted: false,
          submodule: false,
        },
      ],
    });
    render(<GraphView repoId={id} />);
    expect(screen.getByText("Working tree changes (1 file)")).toBeInTheDocument();
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(useGraphStore.getState().selectedOid).toBe("WIP");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(useGraphStore.getState().selectedOid).toBe("c0");
  });

  it("renders the column header", () => {
    seed(2);
    render(<GraphView repoId={id} />);
    expect(screen.getByText("Branch / Tag")).toBeInTheDocument();
    expect(screen.getByText("Graph")).toBeInTheDocument();
    expect(screen.getByText("Commit message")).toBeInTheDocument();
  });

  describe("many refs", () => {
    const refAt = (name: string): Ref => ({
      name,
      fullName: `refs/heads/${name}`,
      kind: "localBranch",
      target: "c0",
      upstream: null,
      isHead: false,
    });
    beforeEach(() => {
      seed(3);
      const g = useGraphStore.getState().byRepo[id]!;
      useGraphStore.setState({
        byRepo: {
          [id]: { ...g, refs: { ...noRefs, refs: ["a", "b", "c", "d"].map(refAt) } },
        },
      });
    });

    it("shows two chips and a +N pill that expands and collapses on Escape", () => {
      render(<GraphView repoId={id} />);
      expect(screen.queryByText("c")).toBeNull();
      const pill = screen.getByRole("button", { name: "+2" });
      fireEvent.click(pill);
      expect(screen.getByText("c")).toBeInTheDocument();
      expect(screen.getByText("d")).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
      expect(screen.queryByText("d")).toBeNull();
    });
  });

  describe("branch drag and drop", () => {
    const local = (name: string, target: string): Ref => ({
      name,
      fullName: `refs/heads/${name}`,
      kind: "localBranch",
      target,
      upstream: null,
      isHead: false,
    });
    const transfer = (name: string): object => ({
      types: ["application/x-gitbranch-ref"],
      getData: () => name,
      setData: vi.fn(),
      effectAllowed: "",
      dropEffect: "",
    });

    beforeEach(() => {
      seed(3);
      useDialogsStore.setState({ current: null, busy: false });
      const g = useGraphStore.getState().byRepo[id]!;
      useGraphStore.setState({
        byRepo: {
          [id]: {
            ...g,
            refs: { ...noRefs, refs: [local("feat", "c0"), local("dev", "c1")] },
          },
        },
      });
    });

    it("local branch chips are draggable", () => {
      render(<GraphView repoId={id} />);
      expect(screen.getByText("feat")).toHaveAttribute("draggable", "true");
    });

    it("dropping a branch on a chip opens the merge/rebase picker", () => {
      render(<GraphView repoId={id} />);
      const dataTransfer = transfer("feat");
      fireEvent.dragStart(screen.getByText("feat"), { dataTransfer });
      fireEvent.dragOver(screen.getByText("dev"), { dataTransfer });
      fireEvent.drop(screen.getByText("dev"), { dataTransfer });
      expect(useDialogsStore.getState().current).toMatchObject({
        kind: "custom",
        id: "merge.branchDrop",
        props: {
          repoId: id,
          source: "feat",
          target: "dev",
          targetLabel: "dev",
          targetKind: "local",
        },
      });
    });

    it("dropping a branch on a commit row targets the oid", () => {
      render(<GraphView repoId={id} />);
      const dataTransfer = transfer("feat");
      fireEvent.dragStart(screen.getByText("feat"), { dataTransfer });
      fireEvent.drop(screen.getByText("commit c2"), { dataTransfer });
      expect(useDialogsStore.getState().current).toMatchObject({
        id: "merge.branchDrop",
        props: { source: "feat", target: "c2", targetLabel: "c2", targetKind: "commit" },
      });
    });

    it("dropping a branch on itself does nothing", () => {
      render(<GraphView repoId={id} />);
      const dataTransfer = transfer("feat");
      fireEvent.dragStart(screen.getByText("feat"), { dataTransfer });
      fireEvent.drop(screen.getByText("feat"), { dataTransfer });
      fireEvent.drop(screen.getByText("commit c0"), { dataTransfer });
      expect(useDialogsStore.getState().current).toBeNull();
    });
  });
});
