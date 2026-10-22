import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoId } from "../../ipc/types";

vi.mock("../../ipc/blame", () => ({
  blame: vi.fn().mockResolvedValue({ hunks: [], lines: [] }),
}));

import { blame } from "../../ipc/blame";
import { useUiStore } from "../../state/ui";
import { BlameView } from "./BlameView";

describe("BlameView", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing and returns to the graph when the target belongs to another repo", () => {
    useUiStore.getState().showBlame("old" as RepoId, "a.ts");
    const { container } = render(<BlameView repoId={"new" as RepoId} />);
    expect(container).toBeEmptyDOMElement();
    expect(useUiStore.getState().centerView).toBe("graph");
    expect(blame).not.toHaveBeenCalled();
  });

  it("loads the blame for its own repo", async () => {
    useUiStore.getState().showBlame("r1" as RepoId, "a.ts", "abc");
    render(<BlameView repoId={"r1" as RepoId} />);
    expect(await screen.findByText("Empty file")).toBeTruthy();
    expect(blame).toHaveBeenCalledWith("r1", "a.ts", "abc");
  });

  it("renders only the visible window of a 10k-line blame, hunk starts showing the author", async () => {
    const rect = {
      width: 800,
      height: 400,
      top: 0,
      left: 0,
      right: 800,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(rect);
    const h = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(400);
    const w = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
    try {
      const total = 10_000;
      const per = 10;
      const hunks = Array.from({ length: total / per }, (_, i) => ({
        oid: String(i + 1).padStart(40, "a"),
        author: `Author${i}`,
        authorTime: 1_700_000_000,
        summary: "s",
        startLine: i * per + 1,
        lineCount: per,
        boundary: false,
        path: "a.ts",
      }));
      const lines = Array.from({ length: total }, (_, i) => `line ${i + 1}`);
      vi.mocked(blame).mockResolvedValueOnce({ hunks, lines });
      useUiStore.getState().showBlame("r2" as RepoId, "big.ts");
      const { container } = render(<BlameView repoId={"r2" as RepoId} />);
      expect(await screen.findByText("Author0")).toBeTruthy();
      const rows = container.querySelectorAll("[data-index]");
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(200);
      expect(screen.getByText("Author1")).toBeTruthy();
      expect(screen.queryByText("Author900")).toBeNull();
    } finally {
      spy.mockRestore();
      h.mockRestore();
      w.mockRestore();
    }
  });
});
