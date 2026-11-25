import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const markdownText = await readFile(new URL("../src/Markdown.tsx", import.meta.url), "utf8");
const markdownJs = ts.transpileModule(markdownText, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
}).outputText;
const markdownModule = { exports: {} };
new Function("require", "module", "exports", markdownJs)(require, markdownModule, markdownModule.exports);
const { Markdown, citationNumbers } = markdownModule.exports;

test("only known citation markers render controls, including inside bold text", () => {
  const html = renderToStaticMarkup(React.createElement(Markdown, {
    text: "**Fact [[source:1]]** and [[source:42]]",
    renderCitation: (number) => number === 1 ? React.createElement("button", null, number) : null,
  }));
  assert.match(html, /<strong>Fact <button>1<\/button><\/strong>/);
  assert.match(html, /\[unverified citation\]/);
  assert.doesNotMatch(html, /<button>42<\/button>/);
});

test("model-generated links cannot use script URLs", () => {
  const html = renderToStaticMarkup(React.createElement(Markdown, { text: "[bad](javascript:alert)" }));
  assert.doesNotMatch(html, /href=/);
});

test("parenthesized model references can open only sources from the same turn", () => {
  for (const citation of ["(source: 1)", "(source: [1])"]) {
    const text = `**Aurelia models ${citation}** (source: [9]) \`(source: [2])\` (source: [3)`;
    assert.deepEqual([...citationNumbers(text)], [1, 9]);
    const html = renderToStaticMarkup(React.createElement(Markdown, {
      text,
      renderCitation: (number) => number === 1 ? React.createElement("button", null, number) : null,
    }));
    assert.match(html, /<strong>Aurelia models <button>1<\/button><\/strong>/);
    assert.match(html, /\(source: \[9\]\).*<code[^>]*>\(source: \[2\]\)<\/code>.*\(source: \[3\)/);
    assert.equal((html.match(/<button>/g) ?? []).length, 1);
  }
});

test("labeled citation groups resolve independently without treating bare numbers as sources", () => {
  const text = "Deposit [3]. (FONTI : [01, 2; 9, 1])";
  assert.deepEqual([...citationNumbers(text)], [1, 2, 9]);
  const html = renderToStaticMarkup(React.createElement(Markdown, {
    text,
    renderCitation: (number) => number < 4 ? React.createElement("button", null, number) : null,
  }));
  assert.match(html, /Deposit \[3\]\. <button>1<\/button> <button>2<\/button> \[unverified citation\]/);
  assert.equal((html.match(/<button>/g) ?? []).length, 2);
});

globalThis.window = {};
globalThis.sessionStorage = { getItem: () => "", setItem: () => {} };
const apiText = await readFile(new URL("../src/api.ts", import.meta.url), "utf8");
const apiJs = ts.transpileModule(apiText, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { streamChat } = await import(`data:text/javascript;base64,${Buffer.from(apiJs).toString("base64")}`);

function response(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }));
}

test("SSE handles split CRLF and citation markers and completes once", async () => {
  globalThis.fetch = async () => response([
    'event: sources\r', '\ndata: {"status":"available","sources":[]}\r\n\r',
    '\nevent: token\r\ndata: [[sou\r\n\r\nevent: token\r\ndata: rce:1]]\r\n\r\n',
    'event: done\r\ndata: {"turn_id":"turn::saved"}\r\n\r\n',
  ]);
  let text = "", done = 0, sources, savedTurn;
  const errors = [];
  await streamChat({ message: "x", instance_id: "a" }, {
    onSources: (value) => { sources = value; },
    onToken: (token) => { text += token; },
    onDone: (turnId) => { done++; savedTurn = turnId; },
    onError: (error) => { errors.push(error); },
  });
  assert.equal(text, "[[source:1]]");
  assert.equal(sources.status, "available");
  assert.equal(done, 1);
  assert.equal(savedTurn, "turn::saved");
  assert.deepEqual(errors, []);
});

test("an interrupted SSE stream is reported", async () => {
  globalThis.fetch = async () => response(["event: token\ndata: partial\n\n"]);
  const errors = [];
  await streamChat({ message: "x", instance_id: "a" }, { onError: (error) => errors.push(error) });
  assert.match(errors[0], /ended unexpectedly/);
});
