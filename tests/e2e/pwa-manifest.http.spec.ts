// D-3a regression tests: the web app manifest is built, served and complete.
// Runs in the "http" project (no browser).
//
// The expected values are what a browser needs to offer a real app install
// (MDN "Making PWAs installable", Chrome install criteria): a name, 192px and
// 512px icons, a standalone display mode and a start URL that loads. They are
// not copied from manifest.json: a test that only re-reads the file would pass
// for any content.
//
// Not covered here: the Content-Type and Cache-Control headers vercel.json
// sets for /manifest.json. The test server does not apply vercel.json headers
// (QA_STRATEGY.md section 4b), so those are checked on the Vercel preview.
import { test, expect, type APIRequestContext } from "@playwright/test";
import routerConfig from "../../react-router.config.js";

const PUBLIC_ROUTES: string[] = routerConfig.prerender;

// Width and height from the PNG header (bytes 16-23 of the IHDR chunk).
async function pngSize(request: APIRequestContext, src: string): Promise<string> {
  const res = await request.get(src);
  expect(res.status(), `icon ${src}`).toBe(200);
  const buf = await res.body();
  expect(buf.subarray(1, 4).toString("ascii"), `${src} is a PNG`).toBe("PNG");
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

test("/manifest.json is served and parses as JSON", async ({ request }) => {
  const res = await request.get("/manifest.json", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  const m = await res.json(); // throws, failing the test, if the body is not valid JSON
  expect(m.name).toBe("Mortgage Geek");
  expect(m.short_name).toBeTruthy();
  expect(m.display).toBe("standalone");
  expect(m.start_url).toBe("/");
  expect(m.scope).toBe("/");
});

test("manifest icons exist at their declared sizes, including 192px, 512px and a maskable icon", async ({ request }) => {
  const m = await (await request.get("/manifest.json")).json();
  for (const icon of m.icons) {
    expect(await pngSize(request, icon.src), `${icon.src} declared ${icon.sizes}`).toBe(icon.sizes);
  }
  const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toContain("192x192");
  expect(sizes).toContain("512x512");
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable"), "maskable icon (Android)").toBe(true);
});

test("the launch URL and every shortcut URL load a page", async ({ request }) => {
  const m = await (await request.get("/manifest.json")).json();
  for (const url of [m.start_url, ...m.shortcuts.map((s: { url: string }) => s.url)]) {
    expect((await request.get(url, { maxRedirects: 0 })).status(), url).toBe(200);
  }
  for (const s of m.shortcuts) {
    for (const icon of s.icons) expect((await request.get(icon.src)).status(), `${s.name} icon`).toBe(200);
  }
});

for (const path of PUBLIC_ROUTES) {
  test(`${path} links the site manifest in its prerendered HTML`, async ({ request }) => {
    const html = await (await request.get(path)).text();
    expect(html).toContain('<link rel="manifest" href="/manifest.json"/>');
  });
}

test("the Geek Log keeps its own manifest", async ({ request }) => {
  const res = await request.get("/geeklog.webmanifest");
  expect(res.status()).toBe(200);
  expect((await res.json()).start_url).toBe("/geek-log");
});
