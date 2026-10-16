export type Lang =
  "rust" | "ts" | "js" | "json" | "css" | "md" | "toml" | "yaml" | "sh" | "py" | "c";
export type TokenClass = "keyword" | "string" | "comment" | "number";
export interface Token {
  text: string;
  cls: TokenClass | null;
}

const EXT: Record<string, Lang> = {
  rs: "rust",
  ts: "ts",
  tsx: "ts",
  js: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  json: "json",
  css: "css",
  md: "md",
  toml: "toml",
  yml: "yaml",
  yaml: "yaml",
  sh: "sh",
  bash: "sh",
  py: "py",
  c: "c",
  h: "c",
  cpp: "c",
  hpp: "c",
  cc: "c",
  java: "c",
  go: "c",
  cs: "c",
};

export function langFor(path: string): Lang | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return EXT[name.slice(dot + 1).toLowerCase()] ?? null;
}

const words = (s: string): Set<string> => new Set(s.split(" "));
const JS_KW =
  "const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof in of this null undefined true false void yield static";
const TS_KW = `${JS_KW} interface type enum implements readonly public private protected abstract as namespace declare`;

const KEYWORDS: Record<Lang, Set<string>> = {
  rust: words(
    "fn let mut pub struct enum impl trait use mod crate self Self super match if else for while loop return break continue const static ref move async await where as in type dyn unsafe true false",
  ),
  ts: words(TS_KW),
  js: words(JS_KW),
  json: words("true false null"),
  css: words("important"),
  md: words(""),
  toml: words("true false"),
  yaml: words("true false null"),
  sh: words(
    "if then else elif fi for while do done case esac function return in export local echo exit",
  ),
  py: words(
    "def class return if elif else for while in not and or is import from as with try except finally raise pass lambda None True False yield async await",
  ),
  c: words(
    "int char long short float double void unsigned signed const static struct enum union typedef if else for while do switch case break continue return sizeof class public private protected new delete namespace using template this true false null package func var import final extends implements",
  ),
};

const LINE_COMMENT: Record<Lang, string | null> = {
  rust: "//",
  ts: "//",
  js: "//",
  json: null,
  css: null,
  md: null,
  toml: "#",
  yaml: "#",
  sh: "#",
  py: "#",
  c: "//",
};

const BLOCK_COMMENT = new Set<Lang>(["rust", "ts", "js", "css", "c"]);
const IDENT = /[A-Za-z_$]/;
const IDENT_CHAR = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;

/** Single-line tokenizer; no cross-line state. Adjacent same-class tokens are merged. */
export function highlight(text: string, lang: Lang | null): Token[] {
  if (lang === null || lang === "md") return [{ text, cls: null }];
  const out: Token[] = [];
  const push = (s: string, cls: TokenClass | null): void => {
    if (s === "") return;
    const last = out[out.length - 1];
    if (last?.cls === cls) last.text += s;
    else out.push({ text: s, cls });
  };
  const kw = KEYWORDS[lang];
  const lc = LINE_COMMENT[lang];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (lc !== null && text.startsWith(lc, i)) {
      push(text.slice(i), "comment");
      break;
    }
    if (BLOCK_COMMENT.has(lang) && text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      push(text.slice(i, stop), "comment");
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === "\\" ? 2 : 1;
      const stop = Math.min(j + 1, text.length);
      push(text.slice(i, stop), "string");
      i = stop;
      continue;
    }
    if (DIGIT.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[0-9A-Za-z_.]/.test(text[j]!)) j++;
      push(text.slice(i, j), "number");
      i = j;
      continue;
    }
    if (IDENT.test(ch)) {
      let j = i + 1;
      while (j < text.length && IDENT_CHAR.test(text[j]!)) j++;
      const w = text.slice(i, j);
      push(w, kw.has(w) ? "keyword" : null);
      i = j;
      continue;
    }
    push(ch, null);
    i++;
  }
  return out;
}
