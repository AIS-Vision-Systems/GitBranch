import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

function setup(extra: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      title="Delete"
      message="Sure?"
      command="git branch -D x"
      confirmLabel="Delete branch"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...extra}
    />,
  );
  return { onConfirm, onCancel };
}

describe("ConfirmDialog", () => {
  it("shows the message and the command", () => {
    setup();
    expect(screen.getByText("Sure?")).toBeInTheDocument();
    expect(screen.getByText("git branch -D x").tagName).toBe("PRE");
  });

  it("Enter confirms once", async () => {
    const { onConfirm } = setup();
    expect(screen.getByRole("button", { name: "Delete branch" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("danger focuses Cancel and Enter cancels", async () => {
    const { onConfirm, onCancel } = setup({ danger: true });
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("danger: Enter outside the buttons does nothing; on the confirm button it confirms", async () => {
    const { onConfirm, onCancel } = setup({ danger: true });
    screen.getByRole("dialog").focus();
    await userEvent.keyboard("{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    screen.getByRole("button", { name: "Delete branch" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("busy disables confirm and ignores Enter", async () => {
    const { onConfirm } = setup({ busy: true });
    expect(screen.getByRole("button", { name: "Delete branch" })).toBeDisabled();
    await userEvent.keyboard("{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
