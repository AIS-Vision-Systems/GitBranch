import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenedRepo, RepoId } from "../ipc/types";

vi.mock("../ipc/app", () => ({ saveSession: vi.fn(() => Promise.resolve()) }));
vi.mock("../ipc/repo", () => ({ openRepo: vi.fn() }));

import { saveSession } from "../ipc/app";
import * as ipc from "../ipc/repo";
import { useReposStore } from "./repos";
import { deriveSession, startSessionSync } from "./session";
import { useUiStore } from "./ui";

function repo(id: string, path: string, over: Partial<OpenedRepo> = {}): OpenedRepo {
  return {
    repoId: id as RepoId,
    name: id,
    path,
    gitDir: `${path}/.git`,
    isWorktree: false,
    mainWorkTree: null,
    isBare: false,
    ...over,
  };
}

const a = repo("a", "/p/a");
const b = repo("b", "/p/b");
const aWt = repo("w", "/p/a-wt", { isWorktree: true, mainWorkTree: "/p/a" });

describe("session", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(saveSession).mockClear();
    useReposStore.setState({ open: [], currentId: null, aliases: {} });
  });
  afterEach(() => vi.useRealTimers());

  it("derives paths in tab order and the current path", () => {
    expect(deriveSession([a, b, aWt], "b")).toEqual({
      open: ["/p/a", "/p/a-wt", "/p/b"],
      current: "/p/b",
      aliases: {},
    });
    expect(deriveSession([a, b], null)).toEqual({
      open: ["/p/a", "/p/b"],
      current: null,
      aliases: {},
    });
    expect(deriveSession([a], "a", { "/p/a": "A", "/closed": "Z" }).aliases).toEqual({
      "/p/a": "A",
      "/closed": "Z",
    });
  });

  it("saves once for a burst of changes", () => {
    const stop = startSessionSync(300);
    useReposStore.setState({ open: [a], currentId: "a" });
    useReposStore.setState({ open: [a, b], currentId: "b" });
    useReposStore.getState().newTab();
    vi.advanceTimersByTime(299);
    expect(saveSession).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(saveSession).toHaveBeenCalledTimes(1);
    expect(saveSession).toHaveBeenCalledWith({
      open: ["/p/a", "/p/b"],
      current: null,
      aliases: {},
    });
    stop();
  });

  it("saves when only the aliases change", () => {
    const stop = startSessionSync(300);
    useReposStore.getState().setAlias("/p/a", "Alpha");
    vi.advanceTimersByTime(301);
    expect(saveSession).toHaveBeenCalledWith({
      open: [],
      current: null,
      aliases: { "/p/a": "Alpha" },
    });
    stop();
  });

  it("does not save during restore (sync starts after it)", async () => {
    vi.mocked(ipc.openRepo).mockImplementation((p: string) =>
      p === "/p/a"
        ? Promise.resolve(a)
        : p === "/p/b"
          ? Promise.resolve(b)
          : Promise.reject(new Error("x")),
    );
    await useReposStore.getState().restoreSession({
      open: ["/p/a", "/gone", "/p/b"],
      current: "/p/b",
      aliases: { "/p/b/": "Bee" },
    });
    vi.advanceTimersByTime(1000);
    expect(saveSession).not.toHaveBeenCalled();
    expect(useReposStore.getState().open.map((r) => r.repoId)).toEqual(["a", "b"]);
    expect(useReposStore.getState().currentId).toBe("b");
    expect(useReposStore.getState().aliases).toEqual({ "/p/b": "Bee" });
    expect(useUiStore.getState().toasts.some((t) => t.title === "Could not reopen /gone")).toBe(
      true,
    );
  });
});
