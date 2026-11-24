// Serves build/client the way Vercel serves it in production, for the Playwright
// suite (started automatically by playwright.config.ts `webServer`).
//
// Why not `vite preview` or `python3 -m http.server`: both were checked against
// the live site on 2026-11-24 and neither matches it.
//   - vite preview answers any path without an exact file (e.g. /calculator) with
//     the HOMEPAGE html. React then repaints the right page, so a test passes even
//     when the prerendered HTML is wrong, hiding a route missing from the
//     prerender list.
//   - python adds a 301 to a trailing slash (/calculator -> /calculator/), which
//     production does not, and ignores vercel.json, so its rewrites and
//     redirects 404.
//
// What this mirrors (production behavior it was checked against):
//   1. vercel.json `redirects`  -> 308 (permanent) or 307, Location = destination
//   2. an exact file            -> 200 (/sitemap.xml, /assets/x.js)
//   3. <path>/index.html        -> 200, with or without a trailing slash
//   4. vercel.json `rewrites`   -> 200 with the destination's file
//   5. anything else            -> 404 text/plain (production has no 404 page)
// Query strings are ignored for file lookup, as on Vercel.
//
// It reads vercel.json at startup so the test server cannot drift from the
// production config, and refuses to start on a route pattern it cannot
// translate, instead of guessing. /api/* functions are NOT served: tests mock
// them with page.route(). No npm dependencies.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve("build/client");
const PORT = Number(process.env.PORT || 4321);
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// Vercel source patterns use path-to-regexp. Only the two forms vercel.json uses
// today are supported; anything else stops the server so it gets handled
// deliberately rather than silently mismatched.
function toRegExp(source) {
  const escaped = source
    .split("/")
    .map((seg) => {
      if (/^:\w+\*$/.test(seg)) return "(?:.*)"; // :slug*  zero or more segments
      if (/^:\w+$/.test(seg)) return "[^/]+"; // :slug   one segment
      if (/[:*()?+]/.test(seg)) throw new Error(`serveBuild: unsupported vercel.json pattern "${source}"`);
      return seg.replace(/[.\\^$|{}[\]]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${escaped.replace(/\/\(\?:\.\*\)$/, "(?:/.*)?")}/?$`);
}

const redirects = (vercel.redirects || []).map((r) => ({ re: toRegExp(r.source), ...r }));
const rewrites = (vercel.rewrites || []).map((r) => ({ re: toRegExp(r.source), ...r }));

async function fileAt(urlPath) {
  const safe = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const full = join(ROOT, safe);
  if (!full.startsWith(ROOT)) return null;
  for (const candidate of [full, join(full, "index.html")]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {}
  }
  return null;
}

async function send(res, file, status = 200) {
  res.writeHead(status, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(await readFile(file));
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");

  const redirect = redirects.find((r) => r.re.test(pathname));
  if (redirect) {
    res.writeHead(redirect.permanent === false ? 307 : 308, { Location: redirect.destination });
    return res.end();
  }

  const direct = await fileAt(pathname);
  if (direct) return send(res, direct);

  const rewrite = rewrites.find((r) => r.re.test(pathname));
  if (rewrite) {
    const target = await fileAt(rewrite.destination);
    if (target) return send(res, target);
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("The page could not be found\n\nNOT_FOUND\n");
});

server.listen(PORT, () => console.log(`serveBuild: build/client on http://localhost:${PORT}`));
