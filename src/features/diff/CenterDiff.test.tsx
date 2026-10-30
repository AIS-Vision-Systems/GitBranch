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
  fileNewText: vi.fn(),
}));

import { sameTarget, useDetailsStore, WHOLE_FILE_KEY } from "../../state/details";
import { useWipStore } from "../../state/wip";
import { CenterDiff } from "./CenterDiff";

const id = "r1" as RepoId;
const t1: DiffTarget = { kind: "unstaged", path: "a.ts" };
const t2: DiffTarget = { kind: "unstaged", path: "b.ts" };
const reloadFile = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  useDetailsStore.setState({
    selectedFile: { target: t1, label: "a.ts" },
    diff: sampleDiff(),
    loadingDiff: false,
    reloadFile,
    clear: vi.fn(),
    loadDetails: vi.fn(),
  });
});

describe("CenterDiff", () => {
  it("shows the label and target kind; close clears", () => {
    const clear = vi.fn();
    useDetailsStore.setState({ clear });
    render(<CenterDiff repoId={id} />);
    expect(screen.getAllByText("a.ts").length).toBeGreaterThan(0);
    expect(screen.getByText("Unstaged")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close diff" }));
    expect(clear).toHaveBeenCalled();
  });

  it("sameTarget compares fields", () => {
    expect(sameTarget(t1, { ...t1 })).toBe(true);
    expect(sameTarget(t1, t2)).toBe(false);
    expect(sameTarget(t1, { kind: "staged", path: "a.ts" })).toBe(false);
  });

  it("reloads the diff after the op when the same file is still selected", async () => {
    const applyHunk = vi.fn().mockResolvedValue(true);
    useWipStore.setState({ applyHunk, busy: false });
    render(<CenterDiff repoId={id} />);
    fireEvent.click(screen.getByRole("button", { name: "Stage hunk" }));
    await act(() => Promise.resolve());
    expect(applyHunk).toHaveBeenCalled();
    expect(reloadFile).toHaveBeenCalledWith(id, t1, "a.ts");
  });

  it("does not reload when another file was selected meanwhile", async () => {
    let finish: (v: boolean) => void = () => undefined;
    const applyHunk = vi.fn().mockReturnValue(
      new Promise<boolean>((r) => {
        finish = r;
      }),
    );
    useWipStore.setState({ applyHunk, busy: false });
    render(<CenterDiff repoId={id} />);
    fireEvent.click(screen.getByRole("button", { name: "Stage hunk" }));
    act(() => useDetailsStore.setState({ selectedFile: { target: t2, label: "b.ts" } }));
    finish(true);
    await act(() => Promise.resolve());
    expect(reloadFile).not.toHaveBeenCalled();
  });

  it("whole-file toggle shows the full text and persists the choice", () => {
    useDetailsStore.setState({ fullText: "const a = 1;\nconst b = 3;\ntail\n", wholeFile: true });
    render(<CenterDiff repoId={id} />);
    expect(screen.getByText("tail")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Whole file" }));
    expect(screen.queryByText("tail")).toBeNull();
    expect(localStorage.getItem(WHOLE_FILE_KEY)).toBe("false");
    useDetailsStore.setState({ wholeFile: true });
  });
});
