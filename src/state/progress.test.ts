import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoId } from "../ipc/types";
import { cancelOp } from "../ipc/progress";
import { useProgressStore } from "./progress";

vi.mock("../ipc/progress", () => ({ cancelOp: vi.fn(), onOpProgress: vi.fn() }));

const repoId = "r1" as RepoId;
const st = (): ReturnType<typeof useProgressStore.getState> => useProgressStore.getState();
const ev = (opId: string, pct: number | null) => ({
  opId,
  repoId,
  phase: "Receiving objects",
  pct,
  msg: "line",
});

beforeEach(() => {
  vi.resetAllMocks();
  useProgressStore.setState({ active: null, cancelling: false });
});

describe("progress store", () => {
  it("start sets an indeterminate active op", () => {
    st().start({ opId: "a", repoId, title: "Pulling" });
    expect(st().active).toMatchObject({ opId: "a", title: "Pulling", pct: null, phase: "" });
  });

  it("update applies to the active op and ignores foreign ids", () => {
    st().start({ opId: "a", repoId, title: "Pulling" });
    st().update(ev("b", 10));
    expect(st().active?.pct).toBeNull();
    st().update(ev("a", 42));
    expect(st().active).toMatchObject({ pct: 42, phase: "Receiving objects", msg: "line" });
  });

  it("finish clears only the matching op", () => {
    st().start({ opId: "a", repoId, title: "Pulling" });
    st().finish("b");
    expect(st().active).not.toBeNull();
    st().finish("a");
    expect(st().active).toBeNull();
  });

  it("cancel calls cancelOp and sets cancelling", async () => {
    vi.mocked(cancelOp).mockResolvedValue(true);
    st().start({ opId: "a", repoId, title: "Pulling" });
    await st().cancel();
    expect(cancelOp).toHaveBeenCalledWith("a");
    expect(st().cancelling).toBe(true);
  });

  it("cancel resets cancelling when the op id is unknown", async () => {
    vi.mocked(cancelOp).mockResolvedValue(false);
    st().start({ opId: "a", repoId, title: "Pulling" });
    await st().cancel();
    expect(st().cancelling).toBe(false);
  });
});
