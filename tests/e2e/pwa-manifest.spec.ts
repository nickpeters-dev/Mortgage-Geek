// D-3a regression test at the browser level: Chromium itself reads the
// manifest the page links and parses it as a standalone app.
//
// Why not Page.getInstallabilityErrors: current Chromium lets ANY page be
// installed as a basic shortcut, so it reported no installability errors even
// on production while /manifest.json was a 404 (checked 2026-11-24). That check
// cannot tell broken from fixed. The parsed manifest can: with the 404 it was
// empty (no name, no icons, display undefined).
//
// Chromium only: the DevTools protocol call has no WebKit equivalent. iOS
// Safari "Add to Home Screen" uses the apple-touch-icon link and the
// apple-mobile-web-app-* meta tags (covered by the prerender check), and reads
// the manifest's display mode.
import { test, expect, gotoHydrated } from "./support/test";

test("Chromium parses the linked manifest as a standalone Mortgage Geek app", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "DevTools protocol is Chromium-only");
  await gotoHydrated(page, "/calculator");
  const cdp = await page.context().newCDPSession(page);
  const { url, errors, manifest } = await cdp.send("Page.getAppManifest");

  expect(new URL(url).pathname).toBe("/manifest.json");
  expect(errors, "manifest parse errors").toEqual([]);
  expect(manifest?.name).toBe("Mortgage Geek");
  expect(manifest?.display).toBe("kStandalone");
  expect(manifest?.icons?.length ?? 0).toBeGreaterThanOrEqual(2);
});
