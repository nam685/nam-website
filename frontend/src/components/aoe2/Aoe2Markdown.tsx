"use client";

import React from "react";

/**
 * Tiny, dependency-free, CSP-safe Markdown renderer for the coach commentary.
 *
 * Supports the small subset the coach actually emits: ATX headings (#–######), unordered lists
 * (-, *, +), ordered lists (1.), inline **bold** / *italic* / `code`, and paragraphs with line
 * breaks. Everything is escaped first, so no raw HTML from the source can ever reach the DOM
 * (no XSS). No external resources are loaded — purely structural React elements + inline styles.
 */

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "hr" }
  | { kind: "p"; text: string };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ kind: "p", text: para.join("\n") });
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      flushPara();
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      blocks.push({ kind: "hr" });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushPara();
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2],
      });
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      i--;
      blocks.push({ kind: "ul", items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      i--;
      blocks.push({ kind: "ol", items });
      continue;
    }

    para.push(trimmed);
  }
  flushPara();
  return blocks;
}

/**
 * Render inline markdown (**bold**, *italic*, `code`) within already-escaped text into React
 * nodes. Operates on plain strings, so there is no HTML injection surface.
 */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Tokenize on the three inline markers; the captured groups carry their delimiters.
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let n = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const tok = match[0];
    const key = `${keyPrefix}-${n++}`;
    if (tok.startsWith("**")) {
      nodes.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      nodes.push(
        <code
          key={key}
          style={{
            background: "#11161d",
            padding: "0.05rem 0.3rem",
            borderRadius: "3px",
            fontSize: "0.9em",
          }}
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

/** Render a paragraph's text, turning single newlines into <br/>. */
function renderParagraph(text: string, key: string): React.ReactNode {
  const lines = text.split("\n");
  return (
    <p key={key} style={{ margin: "0 0 0.6rem" }}>
      {lines.map((ln, i) => (
        <React.Fragment key={i}>
          {renderInline(ln, `${key}-l${i}`)}
          {i < lines.length - 1 && <br />}
        </React.Fragment>
      ))}
    </p>
  );
}

export default function Aoe2Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        if (b.kind === "heading") {
          const size = Math.max(0.8, 1.15 - (b.level - 1) * 0.1);
          return (
            <div
              key={key}
              style={{
                fontSize: `${size}rem`,
                color: "#e8e8e8",
                fontWeight: 600,
                margin: "0.8rem 0 0.4rem",
              }}
            >
              {renderInline(b.text, `${key}-h`)}
            </div>
          );
        }
        if (b.kind === "hr") {
          return (
            <hr
              key={key}
              style={{
                border: "none",
                borderTop: "1px solid #1d232c",
                margin: "0.8rem 0",
              }}
            />
          );
        }
        if (b.kind === "ul" || b.kind === "ol") {
          const ListTag = b.kind === "ul" ? "ul" : "ol";
          return (
            <ListTag
              key={key}
              style={{
                margin: "0 0 0.6rem",
                paddingLeft: "1.2rem",
                listStyle: b.kind === "ul" ? "disc" : "decimal",
              }}
            >
              {b.items.map((it, j) => (
                <li key={j} style={{ marginBottom: "0.2rem" }}>
                  {renderInline(it, `${key}-i${j}`)}
                </li>
              ))}
            </ListTag>
          );
        }
        return renderParagraph(b.text, key);
      })}
    </>
  );
}
