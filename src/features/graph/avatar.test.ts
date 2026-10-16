import { describe, expect, it } from "vitest";
import { avatarColor, initials } from "./avatar";

describe("initials", () => {
  it("uses the first letters of the first two words", () => {
    expect(initials("Xavi Anguera")).toBe("XA");
    expect(initials("ana maria lopez")).toBe("AM");
  });
  it("uses the first two letters of a single word", () => {
    expect(initials("xavi")).toBe("XA");
    expect(initials("x")).toBe("X");
  });
  it("falls back to ? when empty", () => {
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
  });
});

describe("avatarColor", () => {
  it("is stable per email and within the palette", () => {
    const a = avatarColor("ann@example.com");
    expect(avatarColor("ann@example.com")).toBe(a);
    expect(avatarColor("  ANN@example.com ")).toBe(a);
    for (const e of ["a@b.c", "x@y.z", "", "long.address+tag@some.domain.org"]) {
      const c = avatarColor(e);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(12);
    }
  });
  it("spreads different emails over several colors", () => {
    const set = new Set(Array.from({ length: 40 }, (_, i) => avatarColor(`user${i}@x.org`)));
    expect(set.size).toBeGreaterThan(4);
  });
});
