// D-1 characterization at the source: React's own server renderer, with no
// Mortgage Geek code involved. Runs in the "http" project (Node, no browser).
//
// WHY this exists next to the per-route NUL counts in
// production-routing.http.spec.ts: those counts depend on where multi-byte
// characters happen to fall in each page, so a content edit can move them
// without any change to React. This test depends only on React. It is the
// check that a React upgrade (decision 2026-11-24: D-1 is deferred to the
// React 19 upgrade, no workaround) really fixes D-1:
//
//   - Still passes after the upgrade: the bug is still there. D-1 stays open.
//   - Fails after the upgrade: the renderer changed. Confirm 0 NUL bytes on
//     every route, then empty KNOWN_NUL_BYTES and delete this test.
import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { Writable } from "node:stream";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToPipeableStream } = require("react-dom/server");
const REACT_DOM_VERSION: string = require("react-dom/package.json").version;

function renderToBuffer(element: unknown): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    sink.on("finish", () => resolve(Buffer.concat(chunks)));
    renderToPipeableStream(element, { onShellError: reject, onError: reject }).pipe(sink);
  });
}

// `padding` empty elements fill React's 2048-byte write buffer, then a 4-byte
// emoji arrives with too little room left.
const element = (padding: number) =>
  React.createElement(
    "div",
    null,
    ...Array.from({ length: padding }, (_, i) => React.createElement("i", { key: i })),
    "🤓",
    "•",
  );

test(`D-1 still present in react-dom ${REACT_DOM_VERSION}: the server renderer emits NUL bytes at a buffer boundary`, async () => {
  const found: Record<number, number> = {};
  for (let padding = 2000; padding < 2060; padding++) {
    const nuls = (await renderToBuffer(element(padding))).filter((b) => b === 0).length;
    if (nuls) found[padding] = nuls;
  }
  // Measured with react-dom 18.3.1 on 2026-11-24: one input, 2 NUL bytes.
  expect(found, "padding -> NUL byte count").toEqual({ 2047: 2 });
});
