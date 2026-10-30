import { openUrl } from "@tauri-apps/plugin-opener";
import type { ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "../../lib/markdown";
import styles from "./Markdown.module.css";

function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) =>
      n.kind === "text" || n.kind === "code"
        ? n.text
        : n.kind === "br"
          ? " "
          : inlineText(n.children),
    )
    .join("");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case "text":
        return n.text;
      case "code":
        return <code key={i}>{n.text}</code>;
      case "strong":
        return <strong key={i}>{renderInline(n.children)}</strong>;
      case "del":
        return <del key={i}>{renderInline(n.children)}</del>;
      case "br":
        return <br key={i} />;
      case "em":
        return <em key={i}>{renderInline(n.children)}</em>;
      case "link":
        if (!/^https?:\/\//i.test(n.href)) return <span key={i}>{renderInline(n.children)}</span>;
        return (
          <a
            key={i}
            href={n.href}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              e.preventDefault();
              void openUrl(n.href);
            }}
          >
            {renderInline(n.children)}
          </a>
        );
    }
  });
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.kind) {
    case "heading": {
      const Tag = `h${b.level}` as "h1";
      return (
        <Tag key={i} id={slugify(inlineText(b.children))}>
          {renderInline(b.children)}
        </Tag>
      );
    }
    case "hr":
      return <hr key={i} />;
    case "quote":
      return <blockquote key={i}>{b.children.map(renderBlock)}</blockquote>;
    case "paragraph":
      return <p key={i}>{renderInline(b.children)}</p>;
    case "list": {
      const items = b.items.map((it, j) => {
        const task = b.tasks?.[j] ?? null;
        const sub = b.subs?.[j] ?? null;
        return (
          <li key={j} className={task !== null ? styles["task"] : undefined}>
            {task !== null && <input type="checkbox" checked={task} disabled readOnly />}
            {renderInline(it)}
            {sub !== null && renderBlock(sub, 0)}
          </li>
        );
      });
      return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
    }
    case "code":
      return (
        <pre key={i}>
          <code data-lang={b.lang ?? undefined}>{b.text}</code>
        </pre>
      );
    case "table":
      return (
        <table key={i}>
          <thead>
            <tr>
              {b.header.map((c, j) => (
                <th key={j}>{renderInline(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r, j) => (
              <tr key={j}>
                {r.map((c, k) => (
                  <td key={k}>{renderInline(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}

export function Markdown({
  source,
  breaks = false,
  className,
}: {
  source: string;
  /** Single newlines inside a paragraph become line breaks (GitHub comment style). */
  breaks?: boolean;
  className?: string | undefined;
}) {
  return (
    <div className={className ? `${styles.markdown} ${className}` : styles.markdown}>
      {parseMarkdown(source, { breaks }).map(renderBlock)}
    </div>
  );
}
