import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/merge", () => ({ rebaseTodo: vi.fn() }));

import * as mergeIpc from "../../ipc/merge";
import type { RepoId } from "../../ipc/types";
import { useOpsStore } from "../../state/ops";
import { RebaseDialog } from "./RebaseDialog";
import { moveRow, validateTodo } from "./todo";

const id = "r1" as RepoId;
const rebase = vi.fn();
const rebaseInteractive = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  rebase.mockResolvedValue(true);
  rebaseInteractive.mockResolvedValue(true);
  useOpsStore.setState({ rebase, rebaseInteractive, busy: false });
  vi.mocked(mergeIpc.rebaseTodo).mockResolvedValue([
    { oid: "a".repeat(40), subject: "first" },
    { oid: "b".repeat(40), subject: "second" },
    { oid: "c".repeat(40), subject: "third" },
  ]);
});

function setup() {
  const onClose = vi.fn();
  render(
    <RebaseDialog repoId={id} onto="main" ontoLabel="main" current="feat" onClose={onClose} />,
  );
  return onClose;
}

describe("todo helpers", () => {
  it("moveRow swaps neighbours and ignores out-of-range moves", () => {
    expect(moveRow([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveRow([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });
  it("validateTodo requires the first kept commit to be pick", () => {
    const r = (action: "pick" | "squash" | "drop") => ({ oid: "x", subject: "s", action });
    expect(validateTodo([r("pick"), r("squash")])).toBeNull();
    expect(validateTodo([r("drop"), r("squash")])).toBe("First commit must be pick");
    expect(validateTodo([r("drop")])).not.toBeNull();
  });
});

describe("RebaseDialog", () => {
  it("plain rebase runs rebase onto", async () => {
    const onClose = setup();
    await userEvent.click(screen.getByRole("button", { name: "Rebase feat onto main" }));
    expect(rebase).toHaveBeenCalledWith(id, "main");
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("interactive: reorders, validates the first action and sends the todo", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("checkbox"));
    const start = screen.getByRole("button", { name: "Start rebase" });
    await screen.findByLabelText("Action for first");
    expect(start).toBeEnabled();

    await user.selectOptions(screen.getByLabelText("Action for first"), "squash");
    expect(screen.getByRole("alert")).toHaveTextContent("First commit must be pick");
    expect(start).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Move first down" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(start).toBeEnabled();

    // Alt+ArrowDown on the focused row moves it too.
    fireEvent.keyDown(screen.getByRole("listitem", { name: "pick third" }), {
      key: "ArrowUp",
      altKey: true,
    });
    await user.click(start);
    expect(rebaseInteractive).toHaveBeenCalledWith(id, "main", [
      { action: "pick", oid: "b".repeat(40) },
      { action: "pick", oid: "c".repeat(40) },
      { action: "squash", oid: "a".repeat(40) },
    ]);
  });

  it("shows Nothing to rebase for an empty todo", async () => {
    vi.mocked(mergeIpc.rebaseTodo).mockResolvedValue([]);
    setup();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(await screen.findByText("Nothing to rebase")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start rebase" })).toBeDisabled();
  });
});
