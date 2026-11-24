// HTTP-level checks of how the built site is served: status codes, redirects,
// and the raw HTML before any JavaScript runs. Runs in the "http" project, which
// launches no browser: the `request` fixture is a plain HTTP client.
//
// Expected behavior was taken from the live site (mortgagegeek.ai, 2026-11-24)
// and from vercel.json, not from scripts/serveBuild.mjs. If one of these fails,
// first ask whether production still behaves this way.
import { test, expect } from "@playwright/test";
import routerConfig from "../../react-router.config.js";

const PUBLIC_ROUTES: string[] = routerConfig.prerender;

test("a nested route answers directly with its own prerendered HTML", async ({ request }) => {
  const res = await request.get("/deep-dives/gift-funds", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain('<link rel="canonical" href="https://mortgagegeek.ai/deep-dives/gift-funds"/>');
});

test("query strings do not change which page is served", async ({ request }) => {
  const res = await request.get("/calculator?price=400000&down=10", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('href="https://mortgagegeek.ai/calculator"');
});

test("vercel.json redirect: /geek-maps -> /deep-dives (308)", async ({ request }) => {
  const res = await request.get("/geek-maps", { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(res.headers()["location"]).toBe("/deep-dives");
});

test("vercel.json rewrite: /geek-log is served (not 404) for the SPA to render", async ({ request }) => {
  const res = await request.get("/geek-log", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
});

test("an unknown URL is a 404 in production, not the homepage", async ({ request }) => {
  const res = await request.get("/this-page-does-not-exist", { maxRedirects: 0 });
  expect(res.status()).toBe(404);
});

// KNOWN DEFECT (QA_STRATEGY.md, "Known defects", D-1): prerendering inserts NUL
// bytes before some multi-byte characters. Browsers discard them, so nothing is
// visible, but tools reading the raw HTML may treat the page as binary.
//
// CONCEPT: test.fail() marks a test as EXPECTED to fail. The suite stays green
// while the defect exists, and the moment someone fixes it this test "passes",
// which Playwright reports as a failure, prompting removal of the marker. The
// defect stays visible in every run instead of being deleted or skipped.
const KNOWN_NUL_BYTE_ROUTES = new Set([
  "/deep-dives/gift-funds",
  "/deep-dives/fha-manual-underwriting",
]);

for (const path of PUBLIC_ROUTES) {
  test(`${path} prerendered HTML has no NUL bytes`, async ({ request }) => {
    test.fail(KNOWN_NUL_BYTE_ROUTES.has(path), "Known defect D-1: NUL bytes from prerender");
    const body = await (await request.get(path)).body();
    expect(body.includes(0x00), "HTML contains a NUL (0x00) byte").toBe(false);
  });
}
