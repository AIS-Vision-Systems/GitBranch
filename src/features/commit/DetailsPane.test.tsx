import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoId } from "../../ipc/types";
import { sampleDiff } from "../../test/diffFixtures";

vi.mock("../../ipc/commit", () => ({
  commit: vi.fn(),
  commitTemplate: vi.fn().mockResolvedValue(null),
  headMessage: vi.fn(),
  commitDetails: vi.fn(),
  fileDiff: vi.fn(),
}));

import * as commitIpc from "../../ipc/commit";
import { useDetailsStore } from "../../state/details";
import { EMPTY_GRAPH, useGraphStore, WIP_OID } from "../../state/graph";
import { useUiStore } from "../../state/ui";
import { DetailsPane } from "./DetailsPane";

const id = "r1" as RepoId;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(commitIpc.fileDiff).mockResolvedValue(sampleDiff());
  useGraphStore.setState({
    selectedOid: WIP_OID,
    byRepo: {
      [id]: {
        ...EMPTY_GRAPH,
        status: {
          entries: [
            {
              path: "src/a.ts",
              origPath: null,
              staged: "unmodified",
              unstaged: "modified",
              conflicted: false,
              submodule: false,
            },
          ],
        } as never,
      },
    },
  });
  useDetailsStore.getState().clear();
});

describe("DetailsPane", () => {
  it("clicking a file shows the diff in the center, clicking again returns to the graph", async () => {
    render(<DetailsPane repoId={id} />);
    expect(useUiStore.getState().centerView).toBe("graph");
    const row = (): HTMLElement => screen.getByTitle("src/a.ts");
    fireEvent.click(row());
    expect(useUiStore.getState().centerView).toBe("diff");
    expect(await screen.findByTitle("src/a.ts")).toHaveAttribute("aria-current", "true");
    // The diff is no longer rendered inside the right pane.
    expect(screen.queryByRole("button", { name: "Unified" })).toBeNull();
    fireEvent.click(row());
    expect(useUiStore.getState().centerView).toBe("graph");
    expect(useDetailsStore.getState().selectedFile).toBeNull();
  });
});
