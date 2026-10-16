import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoId } from "../../ipc/types";
import { useOpsStore } from "../../state/ops";
import { CreateBranchDialog } from "./CreateBranchDialog";
import { validateRefName } from "./validate";

const id = "r1" as RepoId;
const createBranch = vi.fn().mockResolvedValue(true);

beforeEach(() => {
  vi.clearAllMocks();
  createBranch.mockResolvedValue(true);
  useOpsStore.setState({ createBranch, busy: false });
});

function setup() {
  const onClose = vi.fn();
  render(
    <CreateBranchDialog repoId={id} startPoint="abc" startLabel="abc1234" onClose={onClose} />,
  );
  return {
    onClose,
    input: screen.getByRole("textbox"),
    create: screen.getByRole("button", { name: "Create" }),
  };
}

describe("validateRefName", () => {
  it.each(["", "a b", "-x", "a..b", "a~b", "a^b", "a:b", "a?b", "a*b", "a[b", "a\\b"])(
    "rejects %j",
    (n) => expect(validateRefName(n)).not.toBeNull(),
  );
  it("accepts normal names", () => {
    expect(validateRefName("feature/x-1")).toBeNull();
  });
});

describe("CreateBranchDialog", () => {
  it("autofocuses the name input and disables Create while invalid", async () => {
    const user = userEvent.setup();
    const { input, create } = setup();
    expect(input).toHaveFocus();
    expect(create).toBeDisabled();
    await user.type(input, "bad name");
    expect(create).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("spaces");
  });

  it("submits on Enter with checkout on by default, then closes", async () => {
    const user = userEvent.setup();
    const { input, onClose } = setup();
    await user.type(input, "feat/x{Enter}");
    expect(createBranch).toHaveBeenCalledWith(id, "feat/x", "abc", true);
    expect(onClose).toHaveBeenCalled();
  });

  it("honours the checkout checkbox and keeps the dialog open on failure", async () => {
    createBranch.mockResolvedValue(false);
    const user = userEvent.setup();
    const { input, create, onClose } = setup();
    await user.click(screen.getByRole("checkbox", { name: "Check out after creating" }));
    await user.type(input, "x");
    await user.click(create);
    expect(createBranch).toHaveBeenCalledWith(id, "x", "abc", false);
    expect(onClose).not.toHaveBeenCalled();
  });
});
