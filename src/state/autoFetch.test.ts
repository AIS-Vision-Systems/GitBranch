import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoId } from "../ipc/types";
import { AUTO_FETCH_TICK_MS, startAutoFetch } from "./autoFetch";
import { useOpsStore } from "./ops";

const id = "r1" as RepoId;
let fetchQuiet: ReturnType<typeof vi.fn<(repoId: RepoId) => Promise<boolean>>>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchQuiet = vi.fn<(repoId: RepoId) => Promise<boolean>>().mockResolvedValue(false);
  useOpsStore.setState({ fetchQuiet });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startAutoFetch", () => {
  it("fetches on start, on every tick and on focus, until stopped", () => {
    const stop = startAutoFetch(id);
    expect(fetchQuiet).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(AUTO_FETCH_TICK_MS * 2);
    expect(fetchQuiet).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new Event("focus"));
    expect(fetchQuiet).toHaveBeenCalledTimes(4);
    expect(fetchQuiet).toHaveBeenLastCalledWith(id);
    stop();
    vi.advanceTimersByTime(AUTO_FETCH_TICK_MS * 4);
    window.dispatchEvent(new Event("focus"));
    expect(fetchQuiet).toHaveBeenCalledTimes(4);
  });

  it("does nothing while the window is hidden", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const stop = startAutoFetch(id);
    vi.advanceTimersByTime(AUTO_FETCH_TICK_MS * 3);
    expect(fetchQuiet).not.toHaveBeenCalled();
    stop();
  });
});
