import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoId } from "../ipc/types";
import { useRemotesStore } from "./remotes";

const listRemotes = vi.fn();
vi.mock("../ipc/remote", () => ({
  listRemotes: (...a: unknown[]): Promise<unknown> => listRemotes(...a) as Promise<unknown>,
}));

const id = "r1" as RepoId;

beforeEach(() => {
  useRemotesStore.setState({ byRepo: {} });
  listRemotes.mockReset();
});

describe("remotes store", () => {
  it("loads and clears", async () => {
    listRemotes.mockResolvedValue([{ name: "origin", fetchUrl: "u", pushUrl: null }]);
    await useRemotesStore.getState().load(id);
    expect(useRemotesStore.getState().byRepo[id]?.[0]?.name).toBe("origin");
    useRemotesStore.getState().clear(id);
    expect(useRemotesStore.getState().byRepo[id]).toBeUndefined();
  });

  it("drops a reply that arrives after clear", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    listRemotes.mockReturnValue(new Promise((r) => (resolve = r)));
    const p = useRemotesStore.getState().load(id);
    useRemotesStore.getState().clear(id);
    resolve([{ name: "origin", fetchUrl: "u", pushUrl: null }]);
    await p;
    expect(useRemotesStore.getState().byRepo[id]).toBeUndefined();
  });

  it("ignores load errors", async () => {
    listRemotes.mockRejectedValue(new Error("x"));
    await useRemotesStore.getState().load(id);
    expect(useRemotesStore.getState().byRepo[id]).toBeUndefined();
  });

  it("drops a stale reply from an older overlapping load", async () => {
    const resolvers: ((v: unknown) => void)[] = [];
    listRemotes.mockImplementation(() => new Promise((r) => resolvers.push(r)));
    const first = useRemotesStore.getState().load(id);
    const second = useRemotesStore.getState().load(id);
    resolvers[1]?.([{ name: "new", fetchUrl: "u", pushUrl: null }]);
    await second;
    resolvers[0]?.([{ name: "old", fetchUrl: "u", pushUrl: null }]);
    await first;
    expect(useRemotesStore.getState().byRepo[id]?.[0]?.name).toBe("new");
  });
});
