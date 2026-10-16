import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InProgress } from "../../ipc/merge";
import type { UndoInfo } from "../../ipc/reflog";
import type { RepoId } from "../../ipc/types";
import { useDialogsStore } from "../../state/dialogs";
import { EMPTY_GRAPH, useGraphStore } from "../../state/graph";
import { useOpsStore } from "../../state/ops";
import { Toolbar } from "./Toolbar";

const id = "r1" as RepoId;
const info: UndoInfo = {
  label: "commit: add thing",
  action: { kind: "resetSoft", target: "a".repeat(40) },
};
const undoLast = vi.fn().mockResolvedValue(true);

function setup(undo: UndoInfo | null, inProgress: InProgress | null = null) {
  useGraphStore.setState({ byRepo: { [id]: { ...EMPTY_GRAPH, undo, inProgress } } });
  return render(
    <div>
      <textarea aria-label="msg" />
      <Toolbar repoId={id} />
    </div>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useOpsStore.setState({ undoLast, busy: false });
  useDialogsStore.setState({ current: null, busy: false });
});

describe("Toolbar undo", () => {
  it("is disabled with a plain label when there is nothing to undo", () => {
    setup(null);
    const b = screen.getByRole("button", { name: "Undo" });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("title", "Nothing to undo");
  });

  it("shows the label, is enabled, and clicking undoes", () => {
    setup(info);
    const b = screen.getByRole("button", { name: "Undo: commit: add thing" });
    expect(b).toBeEnabled();
    fireEvent.click(b);
    expect(undoLast).toHaveBeenCalledWith(id, info);
  });

  it("is disabled while an operation is busy", () => {
    useOpsStore.setState({ busy: true });
    setup(info);
    expect(screen.getByRole("button", { name: /^Undo/ })).toBeDisabled();
  });

  it("Ctrl+Z outside inputs calls undoLast", () => {
    setup(info);
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(undoLast).toHaveBeenCalledTimes(1);
    expect(undoLast).toHaveBeenCalledWith(id, info);
  });

  it("Ctrl+Z inside a textarea does not", () => {
    setup(info);
    fireEvent.keyDown(screen.getByLabelText("msg"), { key: "z", ctrlKey: true });
    expect(undoLast).not.toHaveBeenCalled();
  });

  it("is disabled with an explanation while an operation is in progress", () => {
    setup(info, { kind: "rebase", headName: "x", onto: null, done: 1, total: 3 });
    const b = screen.getByRole("button", { name: /^Undo/ });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("title", "Finish or abort the current operation first");
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(undoLast).not.toHaveBeenCalled();
  });

  it("Ctrl+Z ignores key repeat, selects, modal content and open dialogs", () => {
    setup(info);
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true, repeat: true });
    expect(undoLast).not.toHaveBeenCalled();
    const sel = document.createElement("select");
    document.body.appendChild(sel);
    fireEvent.keyDown(sel, { key: "z", ctrlKey: true });
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    const inner = document.createElement("button");
    modal.appendChild(inner);
    document.body.appendChild(modal);
    fireEvent.keyDown(inner, { key: "z", ctrlKey: true });
    expect(undoLast).not.toHaveBeenCalled();
    useDialogsStore.setState({ current: { kind: "custom", id: "x", props: {} } });
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(undoLast).not.toHaveBeenCalled();
    sel.remove();
    modal.remove();
  });
});
