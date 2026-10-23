import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoId } from "../../ipc/types";
import { useOpsStore } from "../../state/ops";
import { useRemotesStore } from "../../state/remotes";
import { EditRemoteDialog } from "./EditRemoteDialog";

const id = "r1" as RepoId;
const calls: string[] = [];
const renameRemote = vi.fn((_r: RepoId, old: string, name: string) => {
  calls.push(`rename ${old}->${name}`);
  return Promise.resolve(true);
});
const setRemoteUrl = vi.fn((_r: RepoId, name: string, url: string, push: boolean) => {
  calls.push(`url ${name} ${push ? "push" : "pull"} ${url}`);
  return Promise.resolve(true);
});

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  useOpsStore.setState({ renameRemote, setRemoteUrl, busy: false });
  useRemotesStore.setState({
    byRepo: { [id]: [{ name: "origin", fetchUrl: "https://a/x.git", pushUrl: "https://a/y.git" }] },
  });
});

const setup = () => render(<EditRemoteDialog repoId={id} name="origin" onClose={vi.fn()} />);

describe("EditRemoteDialog", () => {
  it("prefills the fields and disables Save until something changes", () => {
    setup();
    expect(screen.getByLabelText("Name")).toHaveValue("origin");
    expect(screen.getByLabelText("Pull URL")).toHaveValue("https://a/x.git");
    expect(screen.getByLabelText("Push URL")).toHaveValue("https://a/y.git");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("a changed push URL only calls setRemoteUrl(push)", async () => {
    const user = userEvent.setup();
    setup();
    const push = screen.getByLabelText("Push URL");
    await user.clear(push);
    await user.type(push, "https://b/z.git");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(renameRemote).not.toHaveBeenCalled();
    expect(calls).toEqual(["url origin push https://b/z.git"]);
  });

  it("rename runs first and URL changes use the new name", async () => {
    const user = userEvent.setup();
    setup();
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "upstream");
    const pull = screen.getByLabelText("Pull URL");
    await user.clear(pull);
    await user.type(pull, "https://c/p.git");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(calls).toEqual(["rename origin->upstream", "url upstream pull https://c/p.git"]);
  });

  it("rejects an empty pull URL", async () => {
    const user = userEvent.setup();
    setup();
    await user.clear(screen.getByLabelText("Pull URL"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("a retry after a partial save skips the finished rename", async () => {
    const user = userEvent.setup();
    setup();
    setRemoteUrl.mockResolvedValueOnce(false);
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "upstream");
    const pull = screen.getByLabelText("Pull URL");
    await user.clear(pull);
    await user.type(pull, "https://c/p.git");
    await user.click(screen.getByRole("button", { name: "Save" }));
    // The store reloads after the rename: the old name is gone.
    useRemotesStore.setState({
      byRepo: { [id]: [{ name: "upstream", fetchUrl: "https://a/x.git", pushUrl: null }] },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(renameRemote).toHaveBeenCalledTimes(1);
    expect(setRemoteUrl).toHaveBeenCalledTimes(2);
    expect(setRemoteUrl).toHaveBeenLastCalledWith(id, "upstream", "https://c/p.git", false);
  });

  it("blocks URLs with redacted credentials", async () => {
    const user = userEvent.setup();
    setup();
    const push = screen.getByLabelText("Push URL");
    await user.clear(push);
    await user.type(push, "https://***@host/x.git");
    expect(screen.getByText(/hides credentials/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
