import { describe, expect, it } from "vitest";
import { highlight, langFor } from "./highlight";

describe("langFor", () => {
  it("infers from extension", () => {
    expect(langFor("src/a/main.rs")).toBe("rust");
    expect(langFor("x.tsx")).toBe("ts");
    expect(langFor("Makefile")).toBeNull();
    expect(langFor("dir.d/file")).toBeNull();
  });
});

describe("highlight", () => {
  it("rust keywords, number and line comment", () => {
    expect(highlight("let x = 42; // hi", "rust")).toEqual([
      { text: "let", cls: "keyword" },
      { text: " x = ", cls: null },
      { text: "42", cls: "number" },
      { text: "; ", cls: null },
      { text: "// hi", cls: "comment" },
    ]);
  });
  it("ts strings with escapes and backticks", () => {
    const t = highlight('const s = "a\\"b" + `c`', "ts");
    expect(t.filter((x) => x.cls === "string").map((x) => x.text)).toEqual(['"a\\"b"', "`c`"]);
  });
  it("block comment single-line", () => {
    const t = highlight("a /* c */ b", "c");
    expect(t.find((x) => x.cls === "comment")?.text).toBe("/* c */");
  });
  it("python and yaml hash comments", () => {
    expect(highlight("def f(): # x", "py")[0]).toEqual({ text: "def", cls: "keyword" });
    expect(highlight("k: v # c", "yaml").at(-1)).toEqual({ text: "# c", cls: "comment" });
  });
  it("json literals", () => {
    const t = highlight('{"a": true, "b": 1.5}', "json");
    expect(t.some((x) => x.cls === "keyword" && x.text === "true")).toBe(true);
    expect(t.some((x) => x.cls === "number" && x.text === "1.5")).toBe(true);
  });
  it("unknown language is one plain token", () => {
    expect(highlight("let x", null)).toEqual([{ text: "let x", cls: null }]);
  });
  it("unterminated string does not throw", () => {
    expect(highlight('x = "abc', "py").at(-1)).toEqual({ text: '"abc', cls: "string" });
  });
});
