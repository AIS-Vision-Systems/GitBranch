import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoId } from "../../ipc/types";
import { EMPTY_GRAPH, useGraphStore } from "../../state/graph";
import { useOpsStore } from "../../state/ops";
import { StashList } from "./StashList";

const id = "r1" as RepoId;
const now = Math.floor(Date.now() / 1000);

const apply = vi.fn().mockResolvedValue(true);
const pop = vi.fn().mockResolvedValue(true);
const drop = vi.fn().mockResolvedValue(true);

beforeEach(() => {
  vi.clearAllMocks();
  useOpsStore.setState({ stashApply: apply, stashPop: pop, stashDrop: drop, busy: false });
  useGraphStore.setState({
    selectedOid: null,
    byRepo: {
      [id]: {
        ...EMPTY_GRAPH,
        stashes: [
          { index: 0, oid: "s0", branch: "main", message: "WIP on main", time: now - 120 },
          { index: 1, oid: "s1", branch: null, message: "other", time: now - 7200 },
        ],
      },
    },
  });
});

describe("StashList", () => {
  it("renders entries with index, message, branch and relative time", () => {
    render(<StashList repoId={id} />);
    expect(screen.getByText("stash@{0}")).toBeInTheDocument();
    expect(screen.getByText("stash@{1}")).toBeInTheDocument();
    expect(screen.getByText("WIP on main")).toBeInTheDocument();
    expect(screen.getByText(/main · 2m ago/)).toBeInTheDocument();
  });

  it("wires Apply, Pop, Drop to the ops store with the entry", async () => {
    const user = userEvent.setup();
    render(<StashList repoId={id} />);
    await user.click(screen.getAllByRole("button", { name: "Apply" })[1]!);
    await user.click(screen.getAllByRole("button", { name: "Pop" })[0]!);
    await user.click(screen.getAllByRole("button", { name: "Drop" })[1]!);
    const stashes = useGraphStore.getState().byRepo[id]!.stashes;
    expect(apply).toHaveBeenCalledWith(id, stashes[1]);
    expect(pop).toHaveBeenCalledWith(id, stashes[0]);
    expect(drop).toHaveBeenCalledWith(id, stashes[1]);
  });

  it("Show selects the stash commit", async () => {
    const user = userEvent.setup();
    const onShown = vi.fn();
    render(<StashList repoId={id} onShown={onShown} />);
    await user.click(screen.getAllByRole("button", { name: "Show" })[0]!);
    expect(useGraphStore.getState().selectedOid).toBe("s0");
    expect(onShown).toHaveBeenCalled();
  });

  it("shows an empty state", () => {
    useGraphStore.setState({ byRepo: { [id]: { ...EMPTY_GRAPH } } });
    render(<StashList repoId={id} />);
    expect(screen.getByText("No stashes")).toBeInTheDocument();
  });
});
