import type { ReactNode } from "react";

function inlineContent(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return <span key={index}>{part}</span>;
  });
}

export function MessageContent({ content }: { content: string }) {
  const blocks = content.trim().split(/\n{2,}/).filter(Boolean);
  if (!blocks.length) return <p className="message-content"><br /></p>;
  return <div className="message-content">{blocks.map((block, index) => {
    const code = block.match(/^```([^\n]*)\n([\s\S]*?)\n```$/);
    if (code) return <pre key={index} tabIndex={0}><code data-language={code[1] || undefined}>{code[2].split("\n").map((line, lineIndex) => <span className="message-code-line" data-line-number={lineIndex + 1} key={lineIndex}>{line || " "}</span>)}</code></pre>;
    const tableLines = block.split("\n").filter((line) => line.includes("|"));
    const isTable = tableLines.length >= 2 && /^\s*\|?\s*:?-{3,}/.test(tableLines[1]);
    if (isTable) {
      const parseRow = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
      const headers = parseRow(tableLines[0]);
      const rows = tableLines.slice(2).map(parseRow);
      return <div className="message-table-scroll" key={index} role="region" aria-label="Response table" tabIndex={0}><table className="message-table"><thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex} scope="col">{inlineContent(cell)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, cellIndex) => <td key={cellIndex}>{inlineContent(row[cellIndex] ?? "")}</td>)}</tr>)}</tbody></table></div>;
    }
    const heading = block.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const Heading = `h${level}` as "h1" | "h2" | "h3";
      return <Heading key={index}>{inlineContent(heading[2])}</Heading>;
    }
    const lines = block.split("\n");
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      return <ul key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{inlineContent(line.replace(/^\s*[-*]\s+/, ""))}</li>)}</ul>;
    }
    return <p key={index}>{lines.map((line, lineIndex) => <span key={lineIndex}>{lineIndex > 0 && <br />}{inlineContent(line)}</span>)}</p>;
  })}</div>;
}
