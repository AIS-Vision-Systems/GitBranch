import guide from "../help/guide.en.md?raw";
import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./markdown";

const t = (text: string) => ({ kind: "text", text });

describe("parseMarkdown blocks", () => {
  it("parses headings 1-3", () => {
    expect(parseMarkdown("# A\n## B\n### C")).toEqual([
      { kind: "heading", level: 1, children: [t("A")] },
      { kind: "heading", level: 2, children: [t("B")] },
      { kind: "heading", level: 3, children: [t("C")] },
    ]);
  });

  it("joins paragraph lines with a space and splits on blank lines", () => {
    expect(parseMarkdown("one\ntwo\n\nthree")).toEqual([
      { kind: "paragraph", children: [t("one two")] },
      { kind: "paragraph", children: [t("three")] },
    ]);
  });

  it("parses unordered and ordered lists", () => {
    expect(parseMarkdown("- a\n- b\n\n1. x\n2. y")).toEqual([
      { kind: "list", ordered: false, items: [[t("a")], [t("b")]] },
      { kind: "list", ordered: true, items: [[t("x")], [t("y")]] },
    ]);
  });

  it("parses fenced code verbatim", () => {
    expect(parseMarkdown("```ts\n# not a heading\n  - x\n```\nafter")).toEqual([
      { kind: "code", lang: "ts", text: "# not a heading\n  - x" },
      { kind: "paragraph", children: [t("after")] },
    ]);
    expect(parseMarkdown("```\na\n```")[0]).toMatchObject({ lang: null, text: "a" });
  });

  it("parses tables with inline code in cells", () => {
    const [b] = parseMarkdown(
      "| Action | Key |\n| --- | --- |\n| Palette | `Ctrl+K` |\n| A | **b** |",
    );
    expect(b).toEqual({
      kind: "table",
      header: [[t("Action")], [t("Key")]],
      rows: [
        [[t("Palette")], [{ kind: "code", text: "Ctrl+K" }]],
        [[t("A")], [{ kind: "strong", children: [t("b")] }]],
      ],
    });
  });

  it("normalises CRLF", () => {
    expect(parseMarkdown("a\r\nb\r\n\r\n- x\r\n")).toEqual([
      { kind: "paragraph", children: [t("a b")] },
      { kind: "list", ordered: false, items: [[t("x")]] },
    ]);
  });

  it("leaves nothing unparsed in guide.en.md", () => {
    const blocks = parseMarkdown(guide);
    expect(blocks.length).toBeGreaterThan(10);
    for (const b of blocks) {
      if (b.kind !== "paragraph") continue;
      const first = b.children[0];
      const text = first?.kind === "text" ? first.text : "";
      expect(text).not.toMatch(/^(\||#|-|`{3})/);
    }
    expect(blocks.filter((b) => b.kind === "table")).toHaveLength(1);
  });
});

describe("parseInline", () => {
  it("parses bold, italics, code and links", () => {
    expect(parseInline("a **b** *c* _d_ `e` [f](https://x.y)")).toEqual([
      t("a "),
      { kind: "strong", children: [t("b")] },
      t(" "),
      { kind: "em", children: [t("c")] },
      t(" "),
      { kind: "em", children: [t("d")] },
      t(" "),
      { kind: "code", text: "e" },
      t(" "),
      { kind: "link", href: "https://x.y", children: [t("f")] },
    ]);
  });

  it("keeps unterminated markers as text", () => {
    expect(parseInline("a **b")).toEqual([t("a **b")]);
    expect(parseInline("a `b")).toEqual([t("a `b")]);
    expect(parseInline("[a](b")).toEqual([t("[a](b")]);
  });

  it("does not treat snake_case as italics", () => {
    expect(parseInline("snake_case_name")).toEqual([t("snake_case_name")]);
  });

  it("handles escapes", () => {
    expect(parseInline("\\*a\\*")).toEqual([t("*a*")]);
  });
});
