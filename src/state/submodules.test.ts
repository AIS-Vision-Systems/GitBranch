import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ipc from "../ipc/submodule";
import type { Submodule } from "../ipc/submodule";
import type { RepoId } from "../ipc/types";
import { submoduleStateLabel, submodulesOf, useSubmodulesStore } from "./submodules";

vi.mock("../ipc/submodule", () => ({ listSubmodules: vi.fn() }));

const id = "r1" as RepoId;
const sub = (path: string): Submodule => ({
  path,
  headOid: null,
  state: "clean",
  describe: null,
  url: null,
});

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  useSubmodulesStore.setState({ byRepo: {} });
});

describe("submodules store", () => {
  it("loads and clears", async () => {
    vi.mocked(ipc.listSubmodules).mockResolvedValue([sub("a")]);
    await useSubmodulesStore.getState().load(id);
    expect(submodulesOf(useSubmodulesStore.getState(), id)).toHaveLength(1);
    useSubmodulesStore.getState().clear(id);
    expect(submodulesOf(useSubmodulesStore.getState(), id)).toHaveLength(0);
  });

  it("drops a stale reply", async () => {
    const first = deferred<Submodule[]>();
    vi.mocked(ipc.listSubmodules).mockReturnValueOnce(first.promise);
    vi.mocked(ipc.listSubmodules).mockResolvedValueOnce([sub("new")]);
    const p1 = useSubmodulesStore.getState().load(id);
    await useSubmodulesStore.getState().load(id);
    first.resolve([sub("old")]);
    await p1;
    expect(useSubmodulesStore.getState().byRepo[id]?.[0]?.path).toBe("new");
  });

  it("drops a reply that lands after clear", async () => {
    const d = deferred<Submodule[]>();
    vi.mocked(ipc.listSubmodules).mockReturnValueOnce(d.promise);
    const p = useSubmodulesStore.getState().load(id);
    useSubmodulesStore.getState().clear(id);
    d.resolve([sub("x")]);
    await p;
    expect(useSubmodulesStore.getState().byRepo[id]).toBeUndefined();
  });
});

describe("submoduleStateLabel", () => {
  it("maps every state", () => {
    expect(submoduleStateLabel("clean")).toBe("Clean");
    expect(submoduleStateLabel("modified")).toBe("Modified");
    expect(submoduleStateLabel("uninitialized")).toBe("Not initialized");
    expect(submoduleStateLabel("conflict")).toBe("Conflict");
  });
});
