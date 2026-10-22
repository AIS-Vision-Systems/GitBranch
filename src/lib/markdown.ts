// Minimal markdown subset parser. Pure: produces a tree, never HTML.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "code"; lang: string | null; text: string }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][] };

const ESCAPABLE = "\\`*_[]()#|-+.!<>{}~";

function pushText(out: Inline[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.kind === "text") last.text += text;
  else out.push({ kind: "text", text });
}

function isWordChar(c: string | undefined): boolean {
  return c !== undefined && /[A-Za-z0-9]/.test(c);
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "\\" && i + 1 < text.length && ESCAPABLE.includes(text[i + 1]!)) {
      pushText(out, text[i + 1]!);
      i += 2;
      continue;
    }
    if (c === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        out.push({ kind: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (c === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        out.push({ kind: "strong", children: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    } else if (c === "*" || c === "_") {
      const opensOk = c === "*" || !isWordChar(text[i - 1]);
      if (opensOk && text[i + 1] !== " ") {
        let end = i + 1;
        for (;;) {
          end = text.indexOf(c, end);
          if (end === -1) break;
          const closesOk = c === "*" || !isWordChar(text[end + 1]);
          if (end > i + 1 && text[end - 1] !== "\\" && closesOk && text[end - 1] !== " ") break;
          end += 1;
        }
        if (end !== -1) {
          out.push({ kind: "em", children: parseInline(text.slice(i + 1, end)) });
          i = end + 1;
          continue;
        }
      }
    } else if (c === "[") {
      const close = text.indexOf("](", i + 1);
      if (close > i) {
        const paren = text.indexOf(")", close + 2);
        if (paren > close + 2) {
          out.push({
            kind: "link",
            href: text.slice(close + 2, paren).trim(),
            children: parseInline(text.slice(i + 1, close)),
          });
          i = paren + 1;
          continue;
        }
      }
    }
    pushText(out, c);
    i += 1;
  }
  return out;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "\\" && s[i + 1] === "|") {
      cur += "|";
      i += 1;
    } else if (c === "`") {
      inCode = !inCode;
      cur += c;
    } else if (c === "|" && !inCode) {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const HEADING = /^(#{1,3})\s+(.*?)\s*#*\s*$/;
const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;
const FENCE = /^\s*```\s*([\w+-]*)\s*$/;

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    line.trim() === "" ||
    HEADING.test(line) ||
    FENCE.test(line) ||
    UL.test(line) ||
    OL.test(line) ||
    (line.includes("|") && next !== undefined && next.includes("-") && SEPARATOR.test(next))
  );
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1; // closing fence (or EOF)
      blocks.push({
        kind: "code",
        lang: fence[1] === "" ? null : (fence[1] ?? null),
        text: body.join("\n"),
      });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      blocks.push({
        kind: "heading",
        level: h[1]!.length as 1 | 2 | 3,
        children: parseInline(h[2]!),
      });
      i += 1;
      continue;
    }
    const next = lines[i + 1];
    if (line.includes("|") && next !== undefined && next.includes("-") && SEPARATOR.test(next)) {
      const header = splitRow(line).map(parseInline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim() !== "" && lines[i]!.includes("|")) {
        rows.push(splitRow(lines[i]!).map(parseInline));
        i += 1;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }
    const isUl = UL.test(line);
    if (isUl || OL.test(line)) {
      const re = isUl ? UL : OL;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = re.exec(lines[i]!);
        if (!m) break;
        i += 1;
        let item = m[1]!;
        // Continuation lines: indented, not a new item or block.
        while (
          i < lines.length &&
          /^\s+\S/.test(lines[i]!) &&
          !UL.test(lines[i]!) &&
          !OL.test(lines[i]!)
        ) {
          item += " " + lines[i]!.trim();
          i += 1;
        }
        items.push(parseInline(item));
      }
      blocks.push({ kind: "list", ordered: !isUl, items });
      continue;
    }
    const para: string[] = [line.trim()];
    i += 1;
    while (i < lines.length && !startsBlock(lines[i]!, lines[i + 1])) {
      para.push(lines[i]!.trim());
      i += 1;
    }
    blocks.push({ kind: "paragraph", children: parseInline(para.join(" ")) });
  }
  return blocks;
}
