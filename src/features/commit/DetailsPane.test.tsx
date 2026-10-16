import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffTarget } from "../../ipc/commit";
import type { RepoId } from "../../ipc/types";
import { sampleDiff } from "../../test/diffFixtures";

vi.mock("../../ipc/commit", () => ({
  commit: vi.fn(),
  commitTemplate: vi.fn().mockResolvedValue(null),
  headMessage: vi.fn(),
  commitDetails: vi.fn(),
  fileDiff: vi.fn(),
}));

import { sameTarget, useDetailsStore } from "../../state/details";
import { EMPTY_GRAPH, useGraphStore, WIP_OID } from "../../state/graph";
import { useWipStore } from "../../state/wip";
import { DetailsPane } from "./DetailsPane";

const id = "r1" as RepoId;
const t1: DiffTarget = { kind: "unstaged", path: "a.ts" };
const t2: DiffTarget = { kind: "unstaged", path: "b.ts" };
const selectFile = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  useGraphStore.setState({
    selectedOid: WIP_OID,
    byRepo: { [id]: { ...EMPTY_GRAPH, status: { entries: [] } as never } },
  });
  useDetailsStore.setState({
    selectedFile: { target: t1, label: "a.ts" },
    diff: sampleDiff(),
    loadingDiff: false,
    selectFile,
    clear: vi.fn(),
    loadDetails: vi.fn(),
  });
});

describe("DetailsPane hunk ops", () => {
  it("sameTarget compares fields", () => {
    expect(sameTarget(t1, { ...t1 })).toBe(true);
    expect(sameTarget(t1, t2)).toBe(false);
    expect(sameTarget(t1, { kind: "staged", path: "a.ts" })).toBe(false);
  });

  it("reloads the diff after the op when the same file is still selected", async () => {
    const applyHunk = vi.fn().mockResolvedValue(true);
    useWipStore.setState({ applyHunk, busy: false });
    render(<DetailsPane repoId={id} />);
    fireEvent.click(screen.getByRole("button", { name: "Stage hunk" }));
    await act(() => Promise.resolve());
    expect(applyHunk).toHaveBeenCalled();
    expect(selectFile).toHaveBeenCalledWith(id, t1, "a.ts");
  });

  it("does not reload when another file was selected meanwhile", async () => {
    let finish: (v: boolean) => void = () => undefined;
    const applyHunk = vi.fn().mockReturnValue(
      new Promise<boolean>((r) => {
        finish = r;
      }),
    );
    useWipStore.setState({ applyHunk, busy: false });
    render(<DetailsPane repoId={id} />);
    fireEvent.click(screen.getByRole("button", { name: "Stage hunk" }));
    act(() => useDetailsStore.setState({ selectedFile: { target: t2, label: "b.ts" } }));
    finish(true);
    await act(() => Promise.resolve());
    expect(selectFile).not.toHaveBeenCalled();
  });
});
