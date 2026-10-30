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
describe("GitHub-flavoured additions", () => {
  it("parses headings 4-6", () => {
    expect(parseMarkdown("#### A\n###### B")).toEqual([
      { kind: "heading", level: 4, children: [t("A")] },
      { kind: "heading", level: 6, children: [t("B")] },
    ]);
  });

  it("parses blockquotes recursively", () => {
    expect(parseMarkdown("> a\n> b")).toEqual([
      {
        kind: "quote",
        children: [{ kind: "paragraph", children: [t("a b")] }],
      },
    ]);
    expect(parseMarkdown("> - x")[0]).toMatchObject({ kind: "quote" });
  });

  it("parses horizontal rules without confusing them with lists", () => {
    expect(parseMarkdown("a\n\n---\n***\n___")).toEqual([
      { kind: "paragraph", children: [t("a")] },
      { kind: "hr" },
      { kind: "hr" },
      { kind: "hr" },
    ]);
  });

  it("parses task lists", () => {
    expect(parseMarkdown("- [ ] todo\n- [x] done\n- plain")).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [[t("todo")], [t("done")], [t("plain")]],
        tasks: [false, true, null],
      },
    ]);
  });

  it("parses nested lists", () => {
    const [b] = parseMarkdown("- a\n  - b\n  - c\n- d");
    expect(b).toMatchObject({ kind: "list", items: [[t("a")], [t("d")]] });
    expect((b as { subs: unknown[] }).subs[0]).toEqual({
      kind: "list",
      ordered: false,
      items: [[t("b")], [t("c")]],
    });
    expect((b as { subs: unknown[] }).subs[1]).toBeNull();
  });

  it("parses strikethrough", () => {
    expect(parseInline("a ~~b~~ c")).toEqual([
      t("a "),
      { kind: "del", children: [t("b")] },
      t(" c"),
    ]);
  });

  it("turns images into links labelled with the alt text", () => {
    expect(parseInline("![shot](https://x.io/a.png)")).toEqual([
      { kind: "link", href: "https://x.io/a.png", children: [t("shot")] },
    ]);
  });

  it("autolinks bare URLs without trailing punctuation", () => {
    expect(parseInline("see https://a.io/x_y, ok")).toEqual([
      t("see "),
      {
        kind: "link",
        href: "https://a.io/x_y",
        children: [t("https://a.io/x_y")],
      },
      t(", ok"),
    ]);
    expect(parseInline("[l](https://a.io)")).toEqual([
      { kind: "link", href: "https://a.io", children: [t("l")] },
    ]);
  });

  it("strips HTML comments, also multi-line, but not in code fences", () => {
    expect(parseMarkdown("a <!-- x --> b\n<!--\nmulti\n-->\nc")).toEqual([
      { kind: "paragraph", children: [t("a  b")] },
      { kind: "paragraph", children: [t("c")] },
    ]);
    expect(parseMarkdown("```\n<!-- keep -->\n```")).toEqual([
      { kind: "code", lang: null, text: "<!-- keep -->" },
    ]);
  });

  it("turns <br> into a break and leaves other HTML as text", () => {
    expect(parseInline("a<br>b<br/>c <b>x</b>")).toEqual([
      t("a"),
      { kind: "br" },
      t("b"),
      { kind: "br" },
      t("c <b>x</b>"),
    ]);
  });

  it("handles CRLF input", () => {
    expect(parseMarkdown("# A\r\n\r\n- [x] b\r\n- c")).toHaveLength(2);
  });

  it("breaks option keeps single newlines as line breaks", () => {
    expect(parseMarkdown("one\ntwo", { breaks: true })).toEqual([
      { kind: "paragraph", children: [t("one"), { kind: "br" }, t("two")] },
    ]);
  });

  it("caps blockquote nesting instead of overflowing the stack", () => {
    const blocks = parseMarkdown(">".repeat(10000) + " deep");
    let depth = 0;
    let b = blocks[0];
    while (b?.kind === "quote") {
      depth += 1;
      b = b.children[0];
    }
    expect(depth).toBe(8);
    expect(b?.kind).toBe("paragraph");
  });

  it("does not go quadratic on unmatched emphasis delimiters", () => {
    const start = Date.now();
    parseInline("_a ".repeat(30000));
    parseInline("*a ".repeat(30000));
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("drops a link title from the href", () => {
    expect(parseInline('[x](https://a.io "title")')).toEqual([
      { kind: "link", href: "https://a.io", children: [t("x")] },
    ]);
  });
});
