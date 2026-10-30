import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOpsStore } from "../../state/ops";
import { CreateRepoDialog } from "./CreateRepoDialog";

vi.mock("../../ipc/repo", () => ({ pickRepoDir: vi.fn() }));
vi.mock("../../ipc/clone", () => ({ listRemoteHeads: vi.fn(), clone: vi.fn() }));
vi.mock("../../ipc/progress", () => ({ cancelOp: vi.fn() }));

const initRepo = vi.fn();
const nameInput = (): HTMLElement => screen.getAllByRole("textbox")[1]!;
const branchInput = (): HTMLElement => screen.getAllByRole("textbox")[2]!;
const create = (): HTMLButtonElement =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Create" });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  initRepo.mockResolvedValue("/p/proj");
  useOpsStore.setState({ initRepo, busy: false });
});

async function fill(name: string): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Parent folder"), "/p");
  if (name !== "") await user.type(nameInput(), name);
  return user;
}

describe("CreateRepoDialog", () => {
  it("disables Create without a name and shows the path preview", async () => {
    render(<CreateRepoDialog onClose={vi.fn()} />);
    await fill("");
    expect(create().disabled).toBe(true);
    await userEvent.setup().type(nameInput(), "proj");
    expect(create().disabled).toBe(false);
    expect(screen.getByText("Creates /p/proj")).toBeTruthy();
  });

  it("disables Create for an invalid name or branch", async () => {
    render(<CreateRepoDialog onClose={vi.fn()} />);
    const user = await fill("a/b");
    expect(create().disabled).toBe(true);
    await user.clear(nameInput());
    await user.type(nameInput(), "proj");
    await user.type(branchInput(), " x");
    expect(screen.getByText("Branch name cannot contain spaces")).toBeTruthy();
    expect(create().disabled).toBe(true);
  });

  it("submits dest, branch and readme", async () => {
    render(<CreateRepoDialog onClose={vi.fn()} />);
    const user = await fill("proj");
    await user.click(screen.getByRole("checkbox"));
    await user.click(create());
    expect(initRepo).toHaveBeenCalledWith({
      dest: "/p/proj",
      initialBranch: "main",
      readme: false,
    });
  });

  it("sends a null branch when empty", async () => {
    render(<CreateRepoDialog onClose={vi.fn()} />);
    const user = await fill("proj");
    await user.clear(branchInput());
    await user.click(create());
    expect(initRepo).toHaveBeenCalledWith({ dest: "/p/proj", initialBranch: null, readme: true });
  });
});
