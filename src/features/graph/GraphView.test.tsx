import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoId, Status } from "../../ipc/types";
import { cleanStatus, commit, noRefs, row } from "../../test/graphFixtures";

vi.mock("../../ipc/graph", () => ({
  loadGraph: vi.fn(),
  listRefs: vi.fn(),
  repoStatus: vi.fn(),
}));

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
});
