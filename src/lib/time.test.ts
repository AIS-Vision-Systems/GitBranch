import { describe, expect, it } from "vitest";
import { formatAbsolute, formatRelative } from "./time";

describe("formatRelative", () => {
  const now = 1_000_000_000;
  it.each([
    [0, "just now"],
    [-30, "just now"],
    [59, "just now"],
    [60, "1m ago"],
    [3599, "59m ago"],
    [3600, "1h ago"],
    [86399, "23h ago"],
    [86400, "1d ago"],
    [6 * 86400, "6d ago"],
    [7 * 86400, "1w ago"],
    [30 * 86400, "1mo ago"],
    [365 * 86400, "1y ago"],
    [800 * 86400, "2y ago"],
  ])("%d seconds ago -> %s", (delta, out) => {
    expect(formatRelative(now - delta, now)).toBe(out);
  });
});

describe("formatAbsolute", () => {
  it("formats local date and time with zero padding", () => {
    const t = new Date(2024, 0, 5, 3, 7).getTime() / 1000;
    expect(formatAbsolute(t)).toBe("2024-01-05 03:07");
  });
});
