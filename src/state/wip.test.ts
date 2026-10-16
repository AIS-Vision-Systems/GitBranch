import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileListItem } from "../features/commit/FileList";
import { IpcError } from "../ipc/core";
import type { HunkSelection } from "../ipc/stage";
import type { RepoId } from "../ipc/types";

vi.mock("../ipc/stage", () => ({
  stageFiles: vi.fn(),
  unstageFiles: vi.fn(),
  discardFiles: vi.fn(),
  stageAll: vi.fn(),
  unstageAll: vi.fn(),
  applyHunk: vi.fn(),
}));
vi.mock("../ipc/commit", () => ({ commitDetails: vi.fn(), fileDiff: vi.fn() }));

import * as ipc from "../ipc/stage";
import * as commitIpc from "../ipc/commit";
import { sampleDiff } from "../test/diffFixtures";
import { useDetailsStore } from "./details";
import { useDialogsStore } from "./dialogs";
import { useUiStore } from "./ui";
import { useWipStore } from "./wip";

const m = vi.mocked(ipc);
const id = "r1" as RepoId;

const item = (path: string, kind: "unstaged" | "untracked"): FileListItem => ({
  key: `${kind}:${path}`,
  path,
  origPath: null,
  kind: "modified",
  target: { kind, path },
  label: path,
});

beforeEach(() => {
  vi.clearAllMocks();
  useDialogsStore.getState().close();
  useUiStore.setState({ toasts: [] });
  useDetailsStore.getState().clear();
});

describe("wip store", () => {
  it("stages paths and reports errors", async () => {
    m.stageFiles.mockResolvedValueOnce(undefined);
    await useWipStore.getState().stage(id, ["a"]);
    expect(m.stageFiles).toHaveBeenCalledWith(id, ["a"]);
    m.unstageFiles.mockRejectedValueOnce(new Error("boom"));
    await useWipStore.getState().unstage(id, ["a"]);
    expect(useUiStore.getState().toasts[0]?.kind).toBe("error");
    expect(useWipStore.getState().busy).toBe(false);
  });

  it("discard asks for confirmation and splits tracked / untracked", async () => {
    m.discardFiles.mockResolvedValueOnce(undefined);
    const p = useWipStore.getState().discard(id, [item("a", "unstaged"), item("b", "untracked")]);
    const spec = useDialogsStore.getState().current;
    expect(spec?.kind).toBe("confirm");
    if (spec?.kind !== "confirm") return;
    expect(spec.danger).toBe(true);
    expect(spec.message).toContain("2 files");
    expect(spec.command).toBe("git restore --worktree -- a\ngit clean -f -d -- b");
    expect(m.discardFiles).not.toHaveBeenCalled();
    await spec.onConfirm();
    expect(await p).toBe(true);
    expect(m.discardFiles).toHaveBeenCalledWith(id, ["a"], ["b"]);
  });

  it("discard does nothing when cancelled", async () => {
    const p = useWipStore.getState().discard(id, [item("a", "unstaged")]);
    useDialogsStore.getState().close();
    expect(await p).toBe(false);
    expect(m.discardFiles).not.toHaveBeenCalled();
  });

  it("stale hunk error toasts and reloads the selected diff", async () => {
    vi.mocked(commitIpc.fileDiff).mockResolvedValue(sampleDiff());
    await useDetailsStore.getState().selectFile(id, { kind: "unstaged", path: "a.ts" }, "a.ts");
    expect(commitIpc.fileDiff).toHaveBeenCalledTimes(1);
    m.applyHunk.mockRejectedValueOnce(new IpcError({ code: "stage.stale", message: "stale" }));
    const sel: HunkSelection = {
      target: { kind: "unstaged", path: "a.ts" },
      hunkIndex: 0,
      hunkHeader: "@@",
      lines: null,
    };
    const ok = await useWipStore.getState().applyHunk(id, sel, "stage");
    expect(ok).toBe(false);
    expect(commitIpc.fileDiff).toHaveBeenCalledTimes(2);
    expect(useUiStore.getState().toasts[0]?.title).toBe("File changed, diff reloaded");
  });

  it("applyHunk resolves true on success", async () => {
    m.applyHunk.mockResolvedValueOnce(undefined);
    const sel: HunkSelection = {
      target: { kind: "staged", path: "a.ts" },
      hunkIndex: 0,
      hunkHeader: "@@",
      lines: [1],
    };
    expect(await useWipStore.getState().applyHunk(id, sel, "unstage")).toBe(true);
    expect(m.applyHunk).toHaveBeenCalledWith(id, sel, "unstage");
  });
});
