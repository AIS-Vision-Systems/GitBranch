import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoId } from "../../ipc/types";
import { useDialogsStore } from "../../state/dialogs";
import { useOpsStore } from "../../state/ops";
import { CreateTagDialog } from "./CreateTagDialog";

const id = "r1" as RepoId;
const createTag = vi.fn().mockResolvedValue(true);

beforeEach(() => {
  vi.clearAllMocks();
  createTag.mockResolvedValue(true);
  useOpsStore.setState({ createTag, busy: false });
  useDialogsStore.getState().close();
});

function setup() {
  render(<CreateTagDialog repoId={id} target="abc" targetLabel="abc1234" onClose={vi.fn()} />);
}

describe("CreateTagDialog", () => {
  it("creates directly without Force", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole("textbox"), "v1");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(createTag).toHaveBeenCalledWith(id, {
      name: "v1",
      target: "abc",
      message: null,
      force: false,
    });
    expect(useDialogsStore.getState().current).toBeNull();
  });

  it("Force goes through a danger confirm with the exact command", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole("textbox"), "v1");
    await user.click(screen.getByRole("checkbox", { name: /Force/ }));
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(createTag).not.toHaveBeenCalled();
    const spec = useDialogsStore.getState().current;
    expect(spec).toMatchObject({ kind: "confirm", danger: true, command: "git tag -f v1 abc" });
    if (spec?.kind === "confirm") await spec.onConfirm();
    expect(createTag).toHaveBeenCalledWith(id, {
      name: "v1",
      target: "abc",
      message: null,
      force: true,
    });
  });
});
