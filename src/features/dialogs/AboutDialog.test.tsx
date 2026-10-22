import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AboutDialog, LICENSE_URL } from "./AboutDialog";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../../ipc/app", () => ({
  appInfo: vi.fn().mockResolvedValue({
    version: "9.8.7",
    gitCoreVersion: "x",
    githubApiVersion: "y",
    startupRepo: null,
  }),
}));

describe("AboutDialog", () => {
  it("shows name, version, creator, guide; license opens the URL; Esc closes", async () => {
    const onClose = vi.fn();
    render(<AboutDialog onClose={onClose} />);
    expect(screen.getByText("GitBranch")).toBeInTheDocument();
    expect(await screen.findByText("Version 9.8.7")).toBeInTheDocument();
    expect(screen.getByText(/Idea and original development: Xavi Anguera/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "User guide" })).toBeInTheDocument();
    fireEvent.click(screen.getByText(/License: free for noncommercial use/));
    expect(openUrl).toHaveBeenCalledWith(LICENSE_URL);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
