// Minimal markdown subset parser. Pure: produces a tree, never HTML.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "del"; children: Inline[] }
  | { kind: "br" }
  | { kind: "link"; href: string; children: Inline[] };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | {
      kind: "list";
      ordered: boolean;
      items: Inline[][];
      /** Per item: task-list state (`null` = plain item). Present only when some item is a task. */
      tasks?: (boolean | null)[];
      /** Per item: nested list. Present only when some item has one. */
      subs?: (Block | null)[];
    }
  | { kind: "quote"; children: Block[] }
  | { kind: "hr" }
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

export interface ParseOptions {
  /** GFM "breaks": a single newline inside a paragraph becomes a line break (PR/issue bodies). */
  breaks?: boolean;
}

const BARE_URL = /^https?:\/\/[^\s<>]+/i;

/** Length of the URL starting at `text[i]` (trailing punctuation and unbalanced `)` excluded), or 0. */
function urlLength(text: string, i: number): number {
  const m = BARE_URL.exec(text.slice(i, i + 2000));
  if (!m) return 0;
  let u = m[0];
  for (;;) {
    const last = u[u.length - 1]!;
    const unbalanced = last === ")" && u.split(")").length > u.split("(").length;
    if (/[.,;:!?'"*_~]/.test(last) || unbalanced) u = u.slice(0, -1);
    else break;
  }
  return u.length > 8 ? u.length : 0;
}

export function parseInline(text: string): Inline[] {
  return inline(text, true);
}

function inline(text: string, auto: boolean): Inline[] {
  const out: Inline[] = [];
  // Delimiters whose closer search already failed: later openers cannot succeed either.
  const noCloser = new Set<string>();
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "<") {
      const br = /^<br\s*\/?>/i.exec(text.slice(i, i + 8));
      if (br) {
        out.push({ kind: "br" });
        i += br[0].length;
        continue;
      }
      if (auto) {
        const n = urlLength(text, i + 1);
        if (n > 0 && text[i + 1 + n] === ">") {
          const href = text.slice(i + 1, i + 1 + n);
          out.push({ kind: "link", href, children: [{ kind: "text", text: href }] });
          i += n + 2;
          continue;
        }
      }
    }
    if (c === "h" && auto && !isWordChar(text[i - 1]) && text.startsWith("http", i)) {
      const n = urlLength(text, i);
      if (n > 0) {
        const href = text.slice(i, i + n);
        out.push({ kind: "link", href, children: [{ kind: "text", text: href }] });
        i += n;
        continue;
      }
    }
    if (c === "~" && text[i + 1] === "~") {
      const end = text.indexOf("~~", i + 2);
      if (end > i + 2) {
        out.push({ kind: "del", children: inline(text.slice(i + 2, end), auto) });
        i = end + 2;
        continue;
      }
    }
    if (c === "!" && text[i + 1] === "[") {
      const close = text.indexOf("](", i + 2);
      const paren = close > i ? text.indexOf(")", close + 2) : -1;
      if (paren > close + 2) {
        // Images are never loaded: show a link labelled with the alt text.
        const href =
          text
            .slice(close + 2, paren)
            .trim()
            .split(/\s+/)[0] ?? "";
        const alt = text.slice(i + 2, close).trim();
        out.push({ kind: "link", href, children: [{ kind: "text", text: alt || href }] });
        i = paren + 1;
        continue;
      }
    }
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
        out.push({ kind: "strong", children: inline(text.slice(i + 2, end), auto) });
        i = end + 2;
        continue;
      }
    } else if (c === "*" || c === "_") {
      const opensOk = c === "*" || !isWordChar(text[i - 1]);
      if (opensOk && text[i + 1] !== " " && !noCloser.has(c)) {
        let end = i + 1;
        for (;;) {
          end = text.indexOf(c, end);
          if (end === -1) break;
          const closesOk = c === "*" || !isWordChar(text[end + 1]);
          if (end > i + 1 && text[end - 1] !== "\\" && closesOk && text[end - 1] !== " ") break;
          end += 1;
        }
        if (end === -1) noCloser.add(c);
        else {
          out.push({ kind: "em", children: inline(text.slice(i + 1, end), auto) });
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
            href:
              text
                .slice(close + 2, paren)
                .trim()
                .split(/\s+/)[0] ?? "",
            children: inline(text.slice(i + 1, close), false),
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
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;

const isOrdered = (marker: string): boolean => /\d/.test(marker);
const indentOf = (ws: string): number => ws.replace(/\t/g, "    ").length;

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    line.trim() === "" ||
    HEADING.test(line) ||
    FENCE.test(line) ||
    HR.test(line) ||
    QUOTE.test(line) ||
    ITEM.test(line) ||
    (line.includes("|") && next !== undefined && next.includes("-") && SEPARATOR.test(next))
  );
}

/** Drops HTML comments (PR templates are full of them), except inside fenced code. */
function stripComments(lines: string[]): string[] {
  const out: string[] = [];
  let chunk: string[] = [];
  let fenced = false;
  const flush = (): void => {
    if (chunk.length === 0) return;
    out.push(
      ...chunk
        .join("\n")
        .replace(/<!--[\s\S]*?(-->|$)/g, "")
        .split("\n"),
    );
    chunk = [];
  };
  for (const l of lines) {
    const f = /^\s*```/.test(l);
    if (!fenced && !f) chunk.push(l);
    else {
      flush();
      out.push(l);
      if (f) fenced = !fenced;
    }
  }
  flush();
  return out;
}

function parseList(lines: string[], start: number, indent: number): { block: Block; next: number } {
  const first = ITEM.exec(lines[start]!)!;
  const ordered = isOrdered(first[2]!);
  const items: Inline[][] = [];
  const tasks: (boolean | null)[] = [];
  const subs: (Block | null)[] = [];
  let i = start;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]!);
    if (!m || indentOf(m[1]!) < indent || isOrdered(m[2]!) !== ordered) break;
    if (HR.test(lines[i]!)) break;
    i += 1;
    let item = m[3]!;
    // Continuation lines: indented, not a new item or block.
    while (i < lines.length && /^\s+\S/.test(lines[i]!) && !ITEM.test(lines[i]!)) {
      item += " " + lines[i]!.trim();
      i += 1;
    }
    let task: boolean | null = null;
    const t = TASK.exec(item);
    if (t) {
      task = t[1] !== " ";
      item = t[2]!;
    }
    let sub: Block | null = null;
    const nm = i < lines.length ? ITEM.exec(lines[i]!) : null;
    if (nm && indentOf(nm[1]!) > indent) {
      const r = parseList(lines, i, indentOf(nm[1]!));
      sub = r.block;
      i = r.next;
    }
    items.push(inline(item, true));
    tasks.push(task);
    subs.push(sub);
  }
  const block: Block = { kind: "list", ordered, items };
  if (tasks.some((t) => t !== null)) block.tasks = tasks;
  if (subs.some((x) => x !== null)) block.subs = subs;
  return { block, next: i };
}

/** Blockquotes nest at most this deep; deeper `>` markers stay paragraph text. */
const MAX_QUOTE_DEPTH = 8;

export function parseMarkdown(source: string, opts: ParseOptions = {}, depth = 0): Block[] {
  const lines = stripComments(source.replace(/\r\n?/g, "\n").split("\n"));
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
        level: h[1]!.length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(h[2]!),
      });
      i += 1;
      continue;
    }
    if (HR.test(line)) {
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }
    if (depth < MAX_QUOTE_DEPTH && QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const q = QUOTE.exec(lines[i]!);
        if (!q) break;
        inner.push(q[1]!);
        i += 1;
      }
      blocks.push({
        kind: "quote",
        children: parseMarkdown(inner.join("\n"), opts, depth + 1),
      });
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
    const li = ITEM.exec(line);
    if (li) {
      const r = parseList(lines, i, indentOf(li[1]!));
      blocks.push(r.block);
      i = r.next;
      continue;
    }
    const para: string[] = [line.trim()];
    i += 1;
    while (i < lines.length && !startsBlock(lines[i]!, lines[i + 1])) {
      para.push(lines[i]!.trim());
      i += 1;
    }
    if (opts.breaks) {
      const children: Inline[] = [];
      para.forEach((l, j) => {
        if (j > 0) children.push({ kind: "br" });
        children.push(...parseInline(l));
      });
      blocks.push({ kind: "paragraph", children });
    } else blocks.push({ kind: "paragraph", children: parseInline(para.join(" ")) });
  }
  return blocks;
}
