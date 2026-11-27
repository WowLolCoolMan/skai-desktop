import { Fragment, type ElementType, type ReactNode } from "react";

type InlinePart = { kind: "text" | "code" | "strong" | "emphasis" | "link"; text: string; href?: string };

function inlineParts(value: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ kind: "text", text: value.slice(cursor, index) });
    if (match[1] !== undefined) parts.push({ kind: "code", text: match[1] });
    else if (match[2] !== undefined) parts.push({ kind: "strong", text: match[2] });
    else if (match[3] !== undefined) parts.push({ kind: "emphasis", text: match[3] });
    else {
      const href = match[5].trim();
      if (/^(https:\/\/|mailto:)/i.test(href)) parts.push({ kind: "link", text: match[4], href });
      else parts.push({ kind: "text", text: match[0] });
    }
    cursor = index + match[0].length;
  }
  if (cursor < value.length) parts.push({ kind: "text", text: value.slice(cursor) });
  return parts;
}

function Inline({ value }: { value: string }) {
  return <>{inlineParts(value).map((part, index) => {
    const key = `${index}-${part.kind}`;
    if (part.kind === "code") return <code key={key}>{part.text}</code>;
    if (part.kind === "strong") return <strong key={key}>{part.text}</strong>;
    if (part.kind === "emphasis") return <em key={key}>{part.text}</em>;
    if (part.kind === "link" && part.href) return <a key={key} href={part.href} target="_blank" rel="noreferrer">{part.text}</a>;
    return <Fragment key={key}>{part.text}</Fragment>;
  })}</>;
}

type Block = { kind: "paragraph" | "quote" | "heading" | "ul" | "ol" | "code"; lines: string[]; level?: number };

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: Block | null = null;
  let code: string[] | null = null;
  const flushParagraph = () => { if (paragraph.length) blocks.push({ kind: "paragraph", lines: paragraph }); paragraph = []; };
  const flushList = () => { if (list) blocks.push(list); list = null; };
  const flushCode = () => { if (code) blocks.push({ kind: "code", lines: code }); code = null; };

  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trimStart().startsWith("```")) {
      flushParagraph(); flushList();
      if (code) flushCode(); else code = [];
      continue;
    }
    if (code) { code.push(line); continue; }
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { flushParagraph(); flushList(); blocks.push({ kind: "heading", level: heading[1].length, lines: [heading[2]] }); continue; }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) { flushParagraph(); flushList(); blocks.push({ kind: "quote", lines: [quote[1]] }); continue; }
    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const kind = ordered ? "ol" : "ul";
      if (!list || list.kind !== kind) { flushList(); list = { kind, lines: [] }; }
      list.lines.push((unordered ?? ordered)![1]);
      continue;
    }
    flushList(); paragraph.push(line);
  }
  flushParagraph(); flushList(); flushCode();
  return blocks;
}

export function MarkdownPreview({ source }: { source: string }) {
  return <article className="markdown-document-preview" aria-label="Markdown preview">{parseBlocks(source).map((block, index): ReactNode => {
    const content = block.lines.join(block.kind === "paragraph" ? " " : "\n");
    if (block.kind === "heading") {
      const Tag = `h${block.level}` as ElementType;
      return <Tag key={index}><Inline value={content} /></Tag>;
    }
    if (block.kind === "quote") return <blockquote key={index}><Inline value={content} /></blockquote>;
    if (block.kind === "code") return <pre key={index}><code>{content}</code></pre>;
    if (block.kind === "ul" || block.kind === "ol") {
      const Tag = block.kind;
      return <Tag key={index}>{block.lines.map((item, itemIndex) => <li key={itemIndex}><Inline value={item} /></li>)}</Tag>;
    }
    return <p key={index}><Inline value={content} /></p>;
  })}</article>;
}
