import { describe, expect, it } from "vitest";
import { quotePath, quotePaths } from "./shellQuote";

describe("quotePath", () => {
  it("leaves plain paths alone", () => {
    expect(quotePath("src/a-b_c.ts")).toBe("src/a-b_c.ts");
  });
  it("quotes paths with spaces", () => {
    expect(quotePath("my dir/a b.txt")).toBe('"my dir/a b.txt"');
  });
  it("escapes quotes, backslashes and expansions", () => {
    expect(quotePath('a"b')).toBe('"a\\"b"');
    expect(quotePath("a$b")).toBe('"a\\$b"');
  });
  it("quotes an empty path", () => {
    expect(quotePath("")).toBe('""');
  });
  it("joins several paths", () => {
    expect(quotePaths(["a", "b c"])).toBe('a "b c"');
  });
});
