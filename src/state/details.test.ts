import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommitDetails, DiffTarget } from "../ipc/commit";
import type { RepoId } from "../ipc/types";
import { sampleDiff } from "../test/diffFixtures";

vi.mock("../ipc/commit", () => ({ commitDetails: vi.fn(), fileDiff: vi.fn() }));

import * as ipc from "../ipc/commit";
import { useDetailsStore, VIEW_KEY } from "./details";
import { useUiStore } from "./ui";

const m = vi.mocked(ipc);
const id = "r1" as RepoId;

function details(oid: string): CommitDetails {
  return {
    oid,
    parents: [],
    authorName: "A",
    authorEmail: "a@x",
    authorTime: 0,
    committerName: "A",
    committerEmail: "a@x",
    committerTime: 0,
    subject: oid,
    body: "",
    files: [],
  };
}

const target: DiffTarget = { kind: "commit", oid: "a", path: "f.ts" };

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  useDetailsStore.getState().clear();
});

describe("details store center view", () => {
  it("selecting shows the diff, selecting the same file again returns to the graph", async () => {
    m.fileDiff.mockResolvedValue(sampleDiff());
    await useDetailsStore.getState().selectFile(id, target, "f.ts");
    expect(useUiStore.getState().centerView).toBe("diff");
    await useDetailsStore.getState().selectFile(id, target, "f.ts");
    expect(useUiStore.getState().centerView).toBe("graph");
    expect(useDetailsStore.getState().selectedFile).toBeNull();
    expect(m.fileDiff).toHaveBeenCalledTimes(1);
  });

  it("selecting a different file keeps the diff view", async () => {
    m.fileDiff.mockResolvedValue(sampleDiff());
    await useDetailsStore.getState().selectFile(id, target, "f.ts");
    await useDetailsStore.getState().selectFile(id, { ...target, path: "g.ts" }, "g.ts");
    expect(useUiStore.getState().centerView).toBe("diff");
    expect(useDetailsStore.getState().selectedFile?.label).toBe("g.ts");
  });

  it("reloadFile never toggles", async () => {
    m.fileDiff.mockResolvedValue(sampleDiff());
    await useDetailsStore.getState().selectFile(id, target, "f.ts");
    await useDetailsStore.getState().reloadFile(id, target, "f.ts");
    expect(useUiStore.getState().centerView).toBe("diff");
    expect(useDetailsStore.getState().selectedFile).not.toBeNull();
  });

  it("clear and loadDetails reset centerView", async () => {
    m.fileDiff.mockResolvedValue(sampleDiff());
    await useDetailsStore.getState().selectFile(id, target, "f.ts");
    useDetailsStore.getState().clear();
    expect(useUiStore.getState().centerView).toBe("graph");
    await useDetailsStore.getState().selectFile(id, target, "f.ts");
    m.commitDetails.mockResolvedValue(details("b"));
    await useDetailsStore.getState().loadDetails(id, "b");
    expect(useUiStore.getState().centerView).toBe("graph");
  });
});

describe("details store", () => {
  it("loads details", async () => {
    m.commitDetails.mockResolvedValue(details("a"));
    await useDetailsStore.getState().loadDetails(id, "a");
    const s = useDetailsStore.getState();
    expect(m.commitDetails).toHaveBeenCalledWith(id, "a");
    expect(s.details?.oid).toBe("a");
    expect(s.loadingDetails).toBe(false);
  });

  it("drops stale responses", async () => {
    const first = deferred<CommitDetails>();
    m.commitDetails.mockReturnValueOnce(first.promise);
    m.commitDetails.mockResolvedValueOnce(details("b"));
    const p1 = useDetailsStore.getState().loadDetails(id, "a");
    await useDetailsStore.getState().loadDetails(id, "b");
    first.resolve(details("a"));
    await p1;
    expect(useDetailsStore.getState().details?.oid).toBe("b");
  });

  it("selectFile loads the diff and loadDetails clears it", async () => {
    m.fileDiff.mockResolvedValue(sampleDiff());
    await useDetailsStore.getState().selectFile(id, target, "f.ts");
    let s = useDetailsStore.getState();
    expect(m.fileDiff).toHaveBeenCalledWith(id, target);
    expect(s.selectedFile).toEqual({ target, label: "f.ts" });
    expect(s.diff).not.toBeNull();
    expect(s.loadingDiff).toBe(false);

    m.commitDetails.mockResolvedValue(details("b"));
    await useDetailsStore.getState().loadDetails(id, "b");
    s = useDetailsStore.getState();
    expect(s.selectedFile).toBeNull();
    expect(s.diff).toBeNull();
  });

  it("drops a stale diff", async () => {
    const first = deferred<ReturnType<typeof sampleDiff>>();
    m.fileDiff.mockReturnValueOnce(first.promise);
    const p = useDetailsStore.getState().selectFile(id, target, "f.ts");
    useDetailsStore.getState().clear();
    first.resolve(sampleDiff());
    await p;
    expect(useDetailsStore.getState().diff).toBeNull();
  });

  it("persists the view in localStorage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    useDetailsStore.getState().setView("split");
    expect(useDetailsStore.getState().view).toBe("split");
    expect(store.get(VIEW_KEY)).toBe("split");
    vi.unstubAllGlobals();
  });

  it("setView survives a throwing localStorage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("no");
      },
      setItem: () => {
        throw new Error("no");
      },
    });
    expect(() => useDetailsStore.getState().setView("unified")).not.toThrow();
    vi.unstubAllGlobals();
  });

  it("clear resets everything", async () => {
    m.commitDetails.mockResolvedValue(details("a"));
    await useDetailsStore.getState().loadDetails(id, "a");
    useDetailsStore.getState().clear();
    const s = useDetailsStore.getState();
    expect(s.details).toBeNull();
    expect(s.selectedFile).toBeNull();
    expect(s.diff).toBeNull();
  });
});
