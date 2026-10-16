import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/merge", () => ({ merge: vi.fn(), rebase: vi.fn(), rebaseTodo: vi.fn() }));

import { IpcError } from "../../ipc/core";
import * as mergeIpc from "../../ipc/merge";
import type { RepoId } from "../../ipc/types";
import { useDialogsStore } from "../../state/dialogs";
import { useOpsStore } from "../../state/ops";
import { useUiStore } from "../../state/ui";
import { MergeDialog } from "./MergeDialog";

const id = "r1" as RepoId;

beforeEach(() => {
  vi.clearAllMocks();
  useUiStore.setState({ toasts: [] });
  useOpsStore.setState({ busy: false });
  useDialogsStore.setState({ current: null, busy: false });
});

describe("MergeDialog", () => {
  it("closes when the merge stops on conflicts and still shows the conflict toast", async () => {
    vi.mocked(mergeIpc.merge).mockRejectedValue(
      new IpcError({ code: "git.conflict", message: "conflict" }),
    );
    useDialogsStore.getState().open({ kind: "custom", id: "merge.merge", props: {} });
    const onClose = vi.fn(() => useDialogsStore.getState().close());
    render(
      <MergeDialog repoId={id} source="feat" sourceLabel="feat" current="main" onClose={onClose} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Merge feat into main" }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(useUiStore.getState().toasts.at(-1)?.kind).toBe("error");
  });

  it("stays open on a plain failure", async () => {
    vi.mocked(mergeIpc.merge).mockRejectedValue(
      new IpcError({ code: "git.failed", message: "boom" }),
    );
    useDialogsStore.getState().open({ kind: "custom", id: "merge.merge", props: {} });
    const onClose = vi.fn();
    render(
      <MergeDialog repoId={id} source="feat" sourceLabel="feat" current="main" onClose={onClose} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Merge feat into main" }));
    await vi.waitFor(() => expect(useUiStore.getState().toasts.length).toBeGreaterThan(0));
    expect(onClose).not.toHaveBeenCalled();
  });
});
