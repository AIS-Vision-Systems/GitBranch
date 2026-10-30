import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoId } from "../ipc/types";
import { startAutoFetch } from "./autoFetch";
import { useOpsStore } from "./ops";
import { usePullsStore } from "./pulls";

type FetchQuiet = (repoId: RepoId, minGapMs?: number) => Promise<boolean>;
const id = "r1" as RepoId;
type RefreshQuiet = (repoId: RepoId, minGapMs: number) => Promise<void>;
let fetchQuiet: ReturnType<typeof vi.fn<FetchQuiet>>;
let refreshQuiet: ReturnType<typeof vi.fn<RefreshQuiet>>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchQuiet = vi.fn<FetchQuiet>().mockResolvedValue(false);
  useOpsStore.setState({ fetchQuiet });
  refreshQuiet = vi.fn<RefreshQuiet>().mockResolvedValue(undefined);
  usePullsStore.setState({ refreshQuiet });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startAutoFetch", () => {
  it("fetches on start, every interval and on focus, until stopped", () => {
    const stop = startAutoFetch(id, 10);
    expect(fetchQuiet).toHaveBeenCalledTimes(1);
    expect(fetchQuiet).toHaveBeenLastCalledWith(id, 5_000);
    vi.advanceTimersByTime(9_999);
    expect(fetchQuiet).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_001);
    expect(fetchQuiet).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new Event("focus"));
    expect(fetchQuiet).toHaveBeenCalledTimes(4);
    stop();
    vi.advanceTimersByTime(60_000);
    window.dispatchEvent(new Event("focus"));
    expect(fetchQuiet).toHaveBeenCalledTimes(4);
  });

  it("is off for a zero interval", () => {
    const stop = startAutoFetch(id, 0);
    vi.advanceTimersByTime(60_000);
    window.dispatchEvent(new Event("focus"));
    expect(fetchQuiet).not.toHaveBeenCalled();
    stop();
  });

  it("does nothing while the window is hidden", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const stop = startAutoFetch(id, 10);
    vi.advanceTimersByTime(60_000);
    expect(fetchQuiet).not.toHaveBeenCalled();
    stop();
  });

  it("also refreshes pull requests with a gap of at least 15 s, and not while hidden", () => {
    const stop = startAutoFetch(id, 10);
    expect(refreshQuiet).toHaveBeenLastCalledWith(id, 15_000);
    stop();
    const stop2 = startAutoFetch(id, 60);
    expect(refreshQuiet).toHaveBeenLastCalledWith(id, 30_000);
    stop2();
    refreshQuiet.mockClear();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const stop3 = startAutoFetch(id, 10);
    vi.advanceTimersByTime(60_000);
    expect(refreshQuiet).not.toHaveBeenCalled();
    stop3();
  });
});
