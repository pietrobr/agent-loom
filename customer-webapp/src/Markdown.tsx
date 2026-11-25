import React from "react";

// Minimal, dependency-free Markdown renderer for chat answers. Handles the
// subset LLMs actually emit: headings, bullet/numbered lists, bold, italic,
// inline code, and links. Renders to React nodes (no dangerouslySetInnerHTML),
// so model output can't inject HTML.

type RenderCitation = (number: number) => React.ReactNode;

const numberList = String.raw`[0-9]+(?:[ \t]*[,;][ \t]*[0-9]+)*`;
const citationMarker = String.raw`\[\[source[ \t]*:[ \t]*([0-9]+)[ \t]*\]\]|\((?:sources?|font[ei])[ \t]*:[ \t]*(\[${numberList}\]|${numberList})[ \t]*\)`;
const inlinePattern = new RegExp(
  /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|/.source + citationMarker +
  /|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)/.source,
  "gi",
);

function markerNumbers(value: string): number[] {
  return [...new Set((value.match(/[0-9]+/g) ?? []).map(Number))];
}

export function citationNumbers(text: string): Set<number> {
  const numbers = new Set<number>();
  for (const [token, code, link, canonical, labeled] of text.matchAll(inlinePattern)) {
    const marker = canonical ?? labeled;
    if (marker) for (const number of markerNumbers(marker)) numbers.add(number);
    else if (!code && !link) {
      const width = token.startsWith("**") || token.startsWith("__") ? 2 : 1;
      for (const number of citationNumbers(token.slice(width, -width))) numbers.add(number);
    }
  }
  return numbers;
}

function renderInline(text: string, keyPrefix: string, renderCitation?: RenderCitation): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(inlinePattern)) {
    const index = m.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const [tok, code, link, canonical, labeled] = m;
    const marker = canonical ?? labeled;
    const key = `${keyPrefix}-${i++}`;
    if (code) {
      nodes.push(
        <code key={key} style={{ background: "rgba(0,0,0,0.06)", padding: "1px 4px", borderRadius: 4 }}>
          {tok.slice(1, -1)}
        </code>
      );
    } else if (marker) {
      const entries = markerNumbers(marker).map((number) => ({ number, control: renderCitation?.(number) }));
      nodes.push(
        <React.Fragment key={key}>
          {entries.some(({ control }) => control != null)
            ? entries.map(({ number, control }, idx) => (
                <React.Fragment key={number}>{idx > 0 && " "}{control ?? "[unverified citation]"}</React.Fragment>
              ))
            : canonical ? "[unverified citation]" : tok}
        </React.Fragment>
      );
    } else if (link) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (lm) {
        const safe = /^(https?:\/\/|mailto:)/i.test(lm[2]);
        nodes.push(safe ?
          <a key={key} href={lm[2]} target="_blank" rel="noopener noreferrer">
            {lm[1]}
          </a>
          : <span key={key}>{lm[1]}</span>
        );
      } else {
        nodes.push(tok);
      }
    } else if (tok.startsWith("**") || tok.startsWith("__")) {
      nodes.push(<strong key={key}>{renderInline(tok.slice(2, -2), key, renderCitation)}</strong>);
    } else {
      nodes.push(<em key={key}>{renderInline(tok.slice(1, -1), key, renderCitation)}</em>);
    }
    last = index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ text, renderCitation }: { text: string; renderCitation?: RenderCitation }): React.ReactElement {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  let key = 0;
  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={`p-${key++}`} style={{ margin: "0 0 8px" }}>
          {renderInline(para.join(" "), `p${key}`, renderCitation)}
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
            <li key={idx}>{renderInline(it, `li${key}-${idx}`, renderCitation)}</li>
          ))}
        </Tag>
      );
      list = null;
    }
  };

  // Split a GFM table row "| a | b |" into trimmed cells, ignoring the
  // optional leading/trailing pipes.
  const splitRow = (row: string): string[] => {
    let s = row.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.split("|").map((c) => c.trim());
  };
  const isTableSeparator = (row: string): boolean =>
    /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(row);

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);

    // GFM table: a header row, a separator row, then zero or more body rows.
    const next = idx + 1 < lines.length ? lines[idx + 1] : "";
    if (line.includes("|") && isTableSeparator(next) && !heading && !bullet && !numbered) {
      flushPara();
      flushList();
      const headers = splitRow(line);
      const rows: string[][] = [];
      idx += 2; // skip header + separator
      while (idx < lines.length && lines[idx].includes("|") && lines[idx].trim() !== "") {
        rows.push(splitRow(lines[idx]));
        idx++;
      }
      idx--; // the for-loop will increment past the last consumed row
      const tkey = key++;
      blocks.push(
        <div key={`tw-${tkey}`} style={{ overflowX: "auto", margin: "0 0 8px" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
            <thead>
              <tr>
                {headers.map((h, ci) => (
                  <th
                    key={ci}
                    style={{
                      textAlign: "left",
                      padding: "6px 10px",
                      borderBottom: "2px solid rgba(0,0,0,0.18)",
                      background: "rgba(0,0,0,0.04)",
                    }}
                  >
                    {renderInline(h, `th${tkey}-${ci}`, renderCitation)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {headers.map((_, ci) => (
                    <td
                      key={ci}
                      style={{
                        padding: "6px 10px",
                        borderBottom: "1px solid rgba(0,0,0,0.10)",
                        verticalAlign: "top",
                      }}
                    >
                      {renderInline(r[ci] ?? "", `td${tkey}-${ri}-${ci}`, renderCitation)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (heading) {      flushPara();
      flushList();
      const level = Math.min(heading[1].length, 6);
      const size = [0, 18, 17, 16, 15, 14, 13][level];
      blocks.push(
        React.createElement(
          `h${level}`,
          { key: `h-${key++}`, style: { margin: "4px 0 6px", fontSize: size } },
          renderInline(heading[2], `h${key}`, renderCitation)
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
