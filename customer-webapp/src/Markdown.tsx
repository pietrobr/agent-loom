import React from "react";

// Minimal, dependency-free Markdown renderer for chat answers. Handles the
// subset LLMs actually emit: headings, bullet/numbered lists, bold, italic,
// inline code, and links. Renders to React nodes (no dangerouslySetInnerHTML),
// so model output can't inject HTML.

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Order matters: code first (so ** inside code isn't parsed), then links,
  // bold, italic.
  const pattern =
    /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (tok.startsWith("`")) {
      nodes.push(
        <code key={key} style={{ background: "rgba(0,0,0,0.06)", padding: "1px 4px", borderRadius: 4 }}>
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (lm) {
        nodes.push(
          <a key={key} href={lm[2]} target="_blank" rel="noopener noreferrer">
            {lm[1]}
          </a>
        );
      } else {
        nodes.push(tok);
      }
    } else if (tok.startsWith("**") || tok.startsWith("__")) {
      nodes.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ text }: { text: string }): React.ReactElement {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  let key = 0;

  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={`p-${key++}`} style={{ margin: "0 0 8px" }}>
          {renderInline(para.join(" "), `p${key}`)}
        </p>
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const Tag = list.ordered ? "ol" : "ul";
      const cur = list;
      blocks.push(
        <Tag key={`l-${key++}`} style={{ margin: "0 0 8px", paddingLeft: 20 }}>
          {cur.items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `li${key}-${idx}`)}</li>
          ))}
        </Tag>
      );
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);

    if (heading) {
      flushPara();
      flushList();
      const level = Math.min(heading[1].length, 6);
      const size = [0, 18, 17, 16, 15, 14, 13][level];
      blocks.push(
        React.createElement(
          `h${level}`,
          { key: `h-${key++}`, style: { margin: "4px 0 6px", fontSize: size } },
          renderInline(heading[2], `h${key}`)
        )
      );
    } else if (bullet || numbered) {
      flushPara();
      const ordered = !!numbered;
      const item = (bullet ? bullet[1] : numbered![1]).trim();
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(item);
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();

  return <div>{blocks}</div>;
}
