import { describe, expect, it } from "vitest";
import { samePath } from "./paths";

describe("samePath", () => {
  it("normalises separators and trailing slashes", () => {
    expect(samePath("C:\\a\\b", "C:/a/b/", false)).toBe(true);
    expect(samePath("/a/b", "/a/c", false)).toBe(false);
  });
  it("is case-sensitive unless asked otherwise", () => {
    expect(samePath("C:/A", "c:/a", false)).toBe(false);
    expect(samePath("C:/A", "c:/a", true)).toBe(true);
  });
});
