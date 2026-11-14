// Post-build check: every public route must have been prerendered to static HTML.
//
// Usage: npm run build && node scripts/checkPrerender.mjs   (or: npm run verify)
//
// Reads the prerender list from react-router.config.js and, for each path,
// asserts build/client/<path>/index.html exists and carries a non-empty <title>,
// a meta description, and a canonical link. Also asserts the private /geek-log
// route was NOT prerendered, and that public/sitemap.xml lists exactly the
// prerendered paths.
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../react-router.config.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "build/client");
const paths = config.prerender;
let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL ${msg}`); };

if (!existsSync(out)) {
  console.error("build/client not found. Run `npm run build` first.");
  process.exit(2);
}

for (const p of paths) {
  const file = join(out, p === "/" ? "" : p, "index.html");
  if (!existsSync(file)) { fail(`${p}: no prerendered HTML at ${file.slice(root.length + 1)}`); continue; }
  const html = readFileSync(file, "utf-8");
  const title = html.match(/<title>([^<]*)<\/title>/);
  if (!title || !title[1].trim()) fail(`${p}: missing or empty <title>`);
  if (!/<meta[^>]+name="description"[^>]+content="[^"]+"/.test(html)) fail(`${p}: missing meta description`);
  const canonical = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/);
  const want = `https://mortgagegeek.ai${p === "/" ? "/" : p}`;
  if (!canonical) fail(`${p}: missing canonical link`);
  else if (canonical[1].replace(/\/$/, "") !== want.replace(/\/$/, "")) fail(`${p}: canonical is ${canonical[1]}, expected ${want}`);
}

if (existsSync(join(out, "geek-log", "index.html"))) fail("/geek-log: private route was prerendered");

const sitemap = readFileSync(join(root, "public/sitemap.xml"), "utf-8");
const locs = [...sitemap.matchAll(/<loc>https:\/\/mortgagegeek\.ai([^<]*)<\/loc>/g)].map((m) => m[1].replace(/\/$/, "") || "/");
const want = new Set(paths);
const have = new Set(locs);
for (const p of want) if (!have.has(p)) fail(`${p}: prerendered but missing from sitemap.xml`);
for (const p of have) if (!want.has(p)) fail(`${p}: in sitemap.xml but not in the prerender list`);

console.log(failures === 0
  ? `PRERENDER PASS: ${paths.length} public routes have static HTML with title, description, and canonical; sitemap matches`
  : `\nPRERENDER FAIL: ${failures} problems`);
process.exit(failures === 0 ? 0 : 1);
