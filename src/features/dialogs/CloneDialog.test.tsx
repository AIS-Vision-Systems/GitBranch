import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listRemoteHeads } from "../../ipc/clone";
import { cancelOp } from "../../ipc/progress";
import { useOpsStore } from "../../state/ops";
import { CloneDialog } from "./CloneDialog";

vi.mock("../../ipc/clone", () => ({ listRemoteHeads: vi.fn(), clone: vi.fn() }));
vi.mock("../../ipc/progress", () => ({ cancelOp: vi.fn().mockResolvedValue(true) }));
vi.mock("../../ipc/repo", () => ({ pickRepoDir: vi.fn() }));

const list = vi.mocked(listRemoteHeads);
const URL_OK = "https://github.com/acme/beta.git";

beforeEach(() => {
  vi.clearAllMocks();
  useOpsStore.setState({ clone: vi.fn().mockResolvedValue(null), busy: false });
});

describe("CloneDialog branch picker", () => {
  it("loads remote branches into a select", async () => {
    list.mockResolvedValue({ defaultBranch: "main", branches: ["main", "dev"] });
    render(<CloneDialog initialUrl={URL_OK} onClose={vi.fn()} />);
    expect(screen.getByText("Loading branches…")).toBeTruthy();
    const select = await screen.findByRole<HTMLSelectElement>("combobox");
    await screen.findByRole("option", { name: "dev" });
    expect(list).toHaveBeenCalledWith(URL_OK, expect.any(String));
    expect(screen.getByRole("option", { name: "Default branch (main)" })).toBeTruthy();
    expect(select.value).toBe("");
    expect(screen.queryByText("Loading branches…")).toBeNull();
  });

  it("shows the known default immediately", () => {
    list.mockReturnValue(new Promise<never>(() => undefined));
    render(<CloneDialog initialUrl={URL_OK} initialDefaultBranch="trunk" onClose={vi.fn()} />);
    expect(screen.getByRole("option", { name: "Default branch (trunk)" })).toBeTruthy();
  });

  it("falls back to a text input on failure", async () => {
    list.mockRejectedValue(new Error("repository not found"));
    render(<CloneDialog initialUrl={URL_OK} onClose={vi.fn()} />);
    expect(await screen.findByText("Could not list branches: repository not found")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    await userEvent.setup().type(screen.getByPlaceholderText("Remote default"), "dev");
    expect(screen.getByPlaceholderText<HTMLInputElement>("Remote default").value).toBe("dev");
  });
});

describe("CloneDialog lookup timing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const urlInput = (): HTMLInputElement =>
    screen.getByPlaceholderText<HTMLInputElement>("https://github.com/owner/repo.git");
  const typeUrl = (v: string): void => {
    fireEvent.change(urlInput(), { target: { value: v } });
  };
  const advance = async (ms: number): Promise<void> => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it("debounces typing bursts into one lookup", async () => {
    list.mockResolvedValue({ defaultBranch: "main", branches: ["main"] });
    render(<CloneDialog onClose={vi.fn()} />);
    typeUrl("https://github.com/a/b");
    await advance(200);
    typeUrl("https://github.com/a/bc");
    await advance(200);
    typeUrl("https://github.com/a/bcd");
    expect(list).not.toHaveBeenCalled();
    await advance(600);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith("https://github.com/a/bcd", expect.any(String));
  });

  it("does not look up incomplete URLs", async () => {
    render(<CloneDialog onClose={vi.fn()} />);
    typeUrl("https://gi");
    await advance(1000);
    expect(list).not.toHaveBeenCalled();
  });

  it("ignores a slow answer for a previous URL", async () => {
    let resolveFirst: (v: { defaultBranch: string; branches: string[] }) => void = () => undefined;
    list.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)));
    list.mockResolvedValueOnce({ defaultBranch: "dev", branches: ["dev"] });
    render(<CloneDialog onClose={vi.fn()} />);
    typeUrl("https://github.com/a/one");
    await advance(600);
    typeUrl("https://github.com/a/two");
    await advance(600);
    await act(async () => {
      resolveFirst({ defaultBranch: "old", branches: ["old"] });
      await Promise.resolve();
    });
    expect(screen.getByRole("option", { name: "Default branch (dev)" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "old" })).toBeNull();
  });

  it("cancels the in-flight lookup when the URL changes and stays silent", async () => {
    list.mockImplementationOnce(() => new Promise<never>(() => undefined));
    render(<CloneDialog onClose={vi.fn()} />);
    typeUrl("https://github.com/a/one");
    await advance(600);
    const firstId = list.mock.calls[0]?.[1];
    typeUrl("https://github.com/a/two");
    expect(cancelOp).toHaveBeenCalledWith(firstId);
    expect(screen.queryByText(/Could not list branches/)).toBeNull();
  });

  it("cancels on unmount", async () => {
    list.mockImplementationOnce(() => new Promise<never>(() => undefined));
    const { unmount } = render(<CloneDialog onClose={vi.fn()} />);
    typeUrl("https://github.com/a/one");
    await advance(600);
    unmount();
    expect(cancelOp).toHaveBeenCalledWith(list.mock.calls[0]?.[1]);
  });
});
