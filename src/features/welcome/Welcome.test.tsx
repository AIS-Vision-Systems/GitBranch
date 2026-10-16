import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useReposStore } from "../../state/repos";
import { Welcome } from "./Welcome";

describe("Welcome", () => {
  const openPath = vi.fn(() => Promise.resolve(true));
  const forgetRecent = vi.fn(() => Promise.resolve());
  const openViaDialog = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    vi.clearAllMocks();
    useReposStore.setState({
      recent: [{ path: "/p/proj", name: "proj", lastOpened: 1 }],
      openPath,
      forgetRecent,
      openViaDialog,
    });
  });

  it("renders recents and opens on click", async () => {
    render(<Welcome />);
    expect(screen.getByText("proj")).toBeInTheDocument();
    expect(screen.getByTitle("/p/proj")).toBeInTheDocument();
    await userEvent.click(screen.getByTitle("/p/proj"));
    expect(openPath).toHaveBeenCalledWith("/p/proj");
  });

  it("forget does not open", async () => {
    render(<Welcome />);
    await userEvent.click(screen.getByRole("button", { name: /remove proj/i }));
    expect(forgetRecent).toHaveBeenCalledWith("/p/proj");
    expect(openPath).not.toHaveBeenCalled();
  });

  it("open button calls the dialog action", async () => {
    render(<Welcome />);
    await userEvent.click(screen.getByRole("button", { name: "Open repository…" }));
    expect(openViaDialog).toHaveBeenCalled();
  });

  it("shows the empty state", () => {
    useReposStore.setState({ recent: [] });
    render(<Welcome />);
    expect(screen.getByText("No recent repositories")).toBeInTheDocument();
  });
});
