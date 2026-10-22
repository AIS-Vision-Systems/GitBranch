import { describe, expect, it, vi } from "vitest";
import { drainLaunchPaths } from "./launchPath";

describe("drainLaunchPaths", () => {
  it("opens each queued path until null", async () => {
    const take = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce("/a")
      .mockResolvedValueOnce("/b")
      .mockResolvedValue(null);
    const open = vi.fn(() => Promise.resolve(true));
    expect(await drainLaunchPaths(take, open)).toBe(2);
    expect(open.mock.calls).toEqual([["/a"], ["/b"]]);
    expect(take).toHaveBeenCalledTimes(3);
  });

  it("does nothing when the queue is empty", async () => {
    const open = vi.fn(() => Promise.resolve(true));
    expect(await drainLaunchPaths(() => Promise.resolve(null), open)).toBe(0);
    expect(open).not.toHaveBeenCalled();
  });
});
