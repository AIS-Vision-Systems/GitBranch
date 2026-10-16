import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirm, useDialogsStore } from "./dialogs";
import { useUiStore } from "./ui";

const base = { title: "T", message: "M", confirmLabel: "Go" } as const;

function current() {
  const c = useDialogsStore.getState().current;
  if (c?.kind !== "confirm") throw new Error("no confirm dialog open");
  return c;
}

describe("confirm()", () => {
  beforeEach(() => {
    useDialogsStore.getState().close();
  });

  it("resolves true after onConfirm finishes and closes", async () => {
    const onConfirm = vi.fn();
    const p = confirm({ ...base, onConfirm });
    await current().onConfirm();
    await expect(p).resolves.toBe(true);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(useDialogsStore.getState().current).toBeNull();
  });

  it("resolves false on cancel", async () => {
    const onConfirm = vi.fn();
    const p = confirm({ ...base, onConfirm });
    useDialogsStore.getState().close();
    await expect(p).resolves.toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("is busy while onConfirm is pending", async () => {
    let release: () => void = () => undefined;
    const p = confirm({
      ...base,
      onConfirm: () => new Promise<void>((r) => (release = r)),
    });
    const running = current().onConfirm();
    expect(useDialogsStore.getState().busy).toBe(true);
    release();
    await running;
    await expect(p).resolves.toBe(true);
    expect(useDialogsStore.getState().busy).toBe(false);
  });

  it("reports errors and resolves false", async () => {
    const push = vi.spyOn(useUiStore.getState(), "pushToast");
    const p = confirm({
      ...base,
      onConfirm: () => {
        throw new Error("boom");
      },
    });
    await current().onConfirm();
    await expect(p).resolves.toBe(false);
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ kind: "error", title: "boom" }));
    expect(useDialogsStore.getState().current).toBeNull();
    push.mockRestore();
  });
});
