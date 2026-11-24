// HTTP-level checks of how the built site is served: status codes, redirects,
// and the raw HTML before any JavaScript runs. Runs in the "http" project, which
// launches no browser: the `request` fixture is a plain HTTP client.
//
// Expected behavior was taken from the live site (mortgagegeek.ai, 2026-11-24)
// and from vercel.json, not from scripts/serveBuild.mjs. If one of these fails,
// first ask whether production still behaves this way.
import { test, expect } from "@playwright/test";
import routerConfig from "../../react-router.config.js";
import { KNOWN_NUL_BYTES } from "./support/knownDefects";

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

test("paths are case-sensitive, as on Vercel: /Calculator is a 404", async ({ request }) => {
  expect((await request.get("/Calculator", { maxRedirects: 0 })).status()).toBe(404);
  expect((await request.get("/Deep-Dives/gift-funds", { maxRedirects: 0 })).status()).toBe(404);
});

test("an unknown URL is a 404 in production, not the homepage", async ({ request }) => {
  const res = await request.get("/this-page-does-not-exist", { maxRedirects: 0 });
  expect(res.status()).toBe(404);
});

// Known defect D-1 (QA_DEFECT_LOG.md): React 18.3.1's server renderer can emit
// NUL bytes when a multi-byte character lands at its 2048-byte buffer boundary.
//
// CONCEPT: a characterization test pins the defect's EXACT current signature.
// The two affected routes must have exactly their documented count; every
// other route must have none. It fails if the defect is fixed (update the log
// and this table) AND if it spreads or changes, which a test.fail() marker
// would not catch: test.fail() accepts any failure at all.
for (const path of PUBLIC_ROUTES) {
  const expected = KNOWN_NUL_BYTES[path] ?? 0;
  const label = expected ? `has exactly ${expected} NUL byte(s) (known defect D-1)` : "has no NUL bytes";
  test(`${path} prerendered HTML ${label}`, async ({ request }) => {
    const body = await (await request.get(path)).body();
    const nulCount = body.filter((b) => b === 0x00).length;
    expect(nulCount, "NUL (0x00) bytes in the served HTML").toBe(expected);
  });
}
