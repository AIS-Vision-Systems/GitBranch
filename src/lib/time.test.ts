import { describe, expect, it } from "vitest";
import { formatRelative } from "./time";

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
