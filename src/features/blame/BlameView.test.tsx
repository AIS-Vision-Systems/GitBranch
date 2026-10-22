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
});
