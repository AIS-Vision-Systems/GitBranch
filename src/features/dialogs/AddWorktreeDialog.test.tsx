import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ipc from "../../ipc/worktree";
import type { RepoId } from "../../ipc/types";
import { useGraphStore } from "../../state/graph";
import { useWorktreesStore } from "../../state/worktrees";
import { AddWorktreeDialog } from "./AddWorktreeDialog";
import { validateAbsolutePath } from "./validate";

vi.mock("../../ipc/worktree", () => ({ defaultWorktreePath: vi.fn() }));
vi.mock("../../ipc/repo", () => ({ pickRepoDir: vi.fn() }));

const id = "r1" as RepoId;
const add = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  add.mockResolvedValue(true);
  vi.mocked(ipc.defaultWorktreePath).mockImplementation((_r, b) => Promise.resolve(`/wt/${b}`));
  useWorktreesStore.setState({
    add,
    byRepo: { [id]: [{ path: "/m", branch: "main", isMain: true } as never] },
  });
  useGraphStore.setState({
    byRepo: {
      [id]: {
        refs: {
          head: { oid: null, branch: "main", detached: false },
          refs: [
            { name: "main", kind: "localBranch" },
            { name: "dev", kind: "localBranch" },
            { name: "v1", kind: { tag: { annotated: false } } },
          ],
        },
      } as never,
    },
  });
});

function setup() {
  const onClose = vi.fn();
  render(<AddWorktreeDialog repoId={id} onClose={onClose} />);
  return { onClose, add: screen.getByRole("button", { name: "Add" }) };
}

describe("validateAbsolutePath", () => {
  const platform = (ua: string): void => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
  };
  afterEach(() => vi.restoreAllMocks());

  describe("on Windows", () => {
    beforeEach(() => platform("Mozilla/5.0 (Windows NT 10.0)"));
    it.each(["C:\\a", "C:/a", "\\\\srv\\share", "//srv/share"])("accepts %j", (p) =>
      expect(validateAbsolutePath(p)).toBeNull(),
    );
    it.each(["", "a/b", "/a/b", "..\\x"])("rejects %j", (p) =>
      expect(validateAbsolutePath(p)).not.toBeNull(),
    );
  });

  describe("on Unix", () => {
    beforeEach(() => platform("Mozilla/5.0 (X11; Linux x86_64)"));
    it("accepts rooted paths", () => expect(validateAbsolutePath("/a/b")).toBeNull());
    it.each(["", "a/b", "C:\\a", "\\\\srv\\share"])("rejects %j", (p) =>
      expect(validateAbsolutePath(p)).not.toBeNull(),
    );
  });
});

describe("AddWorktreeDialog", () => {
  it("prefills the path from the branch name and submits a new branch", async () => {
    const user = userEvent.setup();
    const { onClose, add: btn } = setup();
    expect(btn).toBeDisabled();
    await user.type(screen.getByLabelText("Branch name"), "feat/x");
    expect(await screen.findByDisplayValue("/wt/feat/x")).toBeTruthy();
    await user.click(btn);
    expect(add).toHaveBeenCalledWith(
      id,
      "/wt/feat/x",
      { kind: "new", branch: "feat/x", startPoint: "HEAD" },
      false,
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("validates the path is absolute", async () => {
    const user = userEvent.setup();
    const { add: btn } = setup();
    await user.type(screen.getByLabelText("Branch name"), "x");
    const path = screen.getByLabelText("Path");
    await user.clear(path);
    await user.type(path, "rel/path");
    expect(await screen.findByRole("alert")).toHaveTextContent("absolute");
    expect(btn).toBeDisabled();
  });

  it("submits an existing branch, disabling checked-out ones", async () => {
    const user = userEvent.setup();
    const { add: btn } = setup();
    await user.click(screen.getByRole("radio", { name: "Existing branch" }));
    expect(screen.getByRole("option", { name: "main (checked out)" })).toBeDisabled();
    expect(await screen.findByDisplayValue("/wt/dev")).toBeTruthy();
    await user.click(btn);
    expect(add).toHaveBeenCalledWith(id, "/wt/dev", { kind: "existing", branch: "dev" }, false);
  });

  it("submits a detached revision with force", async () => {
    const user = userEvent.setup();
    const { add: btn } = setup();
    await user.click(screen.getByRole("radio", { name: "Detached" }));
    await user.click(screen.getByRole("checkbox", { name: "Force" }));
    expect(await screen.findByDisplayValue("/wt/detached")).toBeTruthy();
    await user.click(btn);
    expect(add).toHaveBeenCalledWith(
      id,
      "/wt/detached",
      { kind: "detached", revision: "HEAD" },
      true,
    );
  });
});
