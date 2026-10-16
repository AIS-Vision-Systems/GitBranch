import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDialogsStore } from "../../state/dialogs";
import { useOpsStore } from "../../state/ops";
import { FormDialog } from "./FormDialog";

beforeEach(() => {
  useOpsStore.setState({ busy: false });
  useDialogsStore.setState({ current: null, busy: false });
});

function setup(onSubmit: () => Promise<boolean>) {
  useDialogsStore.getState().open({ kind: "custom", id: "a", props: {} });
  const onClose = vi.fn(() => useDialogsStore.getState().close());
  render(
    <FormDialog title="T" submitLabel="Go" valid onSubmit={onSubmit} onClose={onClose}>
      <input aria-label="x" />
    </FormDialog>,
  );
  return onClose;
}

describe("FormDialog", () => {
  it("ignores Escape while an operation is running", async () => {
    const onClose = setup(() => Promise.resolve(true));
    act(() => useOpsStore.setState({ busy: true }));
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close a later dialog when the submit resolves after this one was dismissed", async () => {
    let resolve: (v: boolean) => void = () => undefined;
    const onClose = setup(
      () =>
        new Promise<boolean>((r) => {
          resolve = r;
        }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => useDialogsStore.getState().open({ kind: "custom", id: "b", props: {} }));
    resolve(true);
    await act(() => Promise.resolve());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useDialogsStore.getState().current).toMatchObject({ id: "b" });
  });

  it("closes when the submit resolves and the dialog is still open", async () => {
    const onClose = setup(() => Promise.resolve(true));
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
