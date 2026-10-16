import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoId } from "../../ipc/types";
import { EMPTY_GRAPH, useGraphStore } from "../../state/graph";
import { useOpsStore } from "../../state/ops";
import { noRefs } from "../../test/graphFixtures";
import { BranchDropDialog } from "./BranchDropDialog";

const id = "r1" as RepoId;
const merge = vi.fn();
const rebase = vi.fn();
const checkout = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  merge.mockResolvedValue(true);
  rebase.mockResolvedValue(true);
  checkout.mockResolvedValue(true);
  useOpsStore.setState({ merge, rebase, checkout, busy: false });
  useGraphStore.setState({
    byRepo: {
      [id]: {
        ...EMPTY_GRAPH,
        refs: { ...noRefs, head: { oid: "h", branch: "main", detached: false } },
      },
    },
  });
});

function setup(target: string, targetKind: "local" | "remote" | "commit" = "local") {
  const onClose = vi.fn();
  render(
    <BranchDropDialog
      repoId={id}
      source="feat"
      target={target}
      targetLabel={target}
      targetKind={targetKind}
      onClose={onClose}
    />,
  );
  return onClose;
}

describe("BranchDropDialog", () => {
  it("titles the dialog and merges directly into the current branch", async () => {
    const onClose = setup("main");
    expect(screen.getByText("feat → main")).toBeInTheDocument();
    expect(screen.getByText("git merge feat")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Merge feat into main/ }));
    expect(checkout).not.toHaveBeenCalled();
    expect(merge).toHaveBeenCalledWith(id, "feat", "default");
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("checks out another target first and shows it in the preview", async () => {
    setup("dev");
    expect(screen.getByText("git switch dev && git merge feat")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Merge feat into dev/ }));
    expect(checkout).toHaveBeenCalledWith(id, "dev", false);
    expect(merge).toHaveBeenCalledWith(id, "feat", "default");
  });

  it("does not merge when the checkout fails", async () => {
    checkout.mockResolvedValue(false);
    const onClose = setup("dev");
    await userEvent.click(screen.getByRole("button", { name: /Merge feat into dev/ }));
    expect(merge).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("rebases the source onto the target", async () => {
    const onClose = setup("dev");
    expect(screen.getByText("git rebase dev feat")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Rebase feat onto dev/ }));
    expect(rebase).toHaveBeenCalledWith(id, "dev", "feat");
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("remote target: no merge into it; rebase and merge it into the source", async () => {
    const onClose = setup("origin/feat2", "remote");
    expect(screen.queryByRole("button", { name: /into origin\/feat2/ })).toBeNull();
    expect(screen.getByText("git rebase origin/feat2 feat")).toBeInTheDocument();
    expect(screen.getByText("git switch feat && git merge origin/feat2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Merge origin\/feat2 into feat/ }));
    expect(checkout).toHaveBeenCalledWith(id, "feat", false);
    expect(merge).toHaveBeenCalledWith(id, "origin/feat2", "default");
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("commit target: rebase onto it or merge it into the source, never detached", async () => {
    const oid = "c".repeat(40);
    setup(oid, "commit");
    expect(screen.getByText("git rebase ccccccc feat")).toBeInTheDocument();
    expect(screen.getByText("git switch feat && git merge ccccccc")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^(Merge|Rebase)/ })).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: /^Merge/ }));
    expect(checkout).toHaveBeenCalledWith(id, "feat", false);
    expect(merge).toHaveBeenCalledWith(id, oid, "default");
  });

  it("merge target into the source skips the switch when the source is current", () => {
    useGraphStore.setState({
      byRepo: {
        [id]: {
          ...EMPTY_GRAPH,
          refs: { ...noRefs, head: { oid: "h", branch: "feat", detached: false } },
        },
      },
    });
    setup("origin/x", "remote");
    expect(screen.getByText("git merge origin/x")).toBeInTheDocument();
  });

  it("disables both buttons while an operation is in progress", () => {
    useGraphStore.setState({
      byRepo: {
        [id]: {
          ...EMPTY_GRAPH,
          refs: { ...noRefs, head: { oid: "h", branch: "main", detached: false } },
          inProgress: { kind: "rebase", headName: null, onto: null, done: 0, total: 1 },
        },
      },
    });
    setup("dev");
    for (const b of screen.getAllByRole("button", { name: /^(Merge|Rebase)/ })) {
      expect(b).toBeDisabled();
    }
  });
});
