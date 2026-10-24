import { describe, expect, it } from "vitest";
import { pathKey, samePath } from "./paths";

describe("pathKey", () => {
  it("normalises separators and trailing slashes", () => {
    expect(pathKey("C:\\a\\b\\", false)).toBe("C:/a/b");
    expect(pathKey("/", false)).toBe("/");
  });
  it("lower-cases only when case-insensitive", () => {
    expect(pathKey("C:/A", false)).toBe("C:/A");
    expect(pathKey("C:/A", true)).toBe("c:/a");
  });
});

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
