import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoId } from "../ipc/types";
import { startAutoFetch } from "./autoFetch";
import { useOpsStore } from "./ops";

type FetchQuiet = (repoId: RepoId, minGapMs?: number) => Promise<boolean>;
const id = "r1" as RepoId;
let fetchQuiet: ReturnType<typeof vi.fn<FetchQuiet>>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchQuiet = vi.fn<FetchQuiet>().mockResolvedValue(false);
  useOpsStore.setState({ fetchQuiet });
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
});
