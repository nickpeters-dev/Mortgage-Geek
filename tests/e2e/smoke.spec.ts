// Smoke test: every public route loads in a real browser, hydrates, and shows
// its page, with no console errors (enforced by the shared fixture).
//
// The route list is read from react-router.config.js, the same list the build
// prerenders, so a new public route is covered automatically.
//
// What this adds over `npm run check:prerender`: that script reads the static
// HTML files. This runs the JavaScript too, so it catches a page that ships
// correct HTML and then throws, logs an error, or loses its title once React
// takes over.
import { test, expect, gotoHydrated } from "./support/test";
import { ROUTES_WITHOUT_H1 } from "./support/knownDefects";
import routerConfig from "../../react-router.config.js";

const PUBLIC_ROUTES: string[] = routerConfig.prerender;
const ROOT_DEFAULT_TITLE = "Mortgage Geek — Plain-English Mortgage Tools & Guides";

for (const path of PUBLIC_ROUTES) {
  test(`${path} loads and hydrates cleanly`, async ({ page }) => {
    const response = await gotoHydrated(page, path);

    // ASSERTION: the server answered with the page itself, no redirect, no 404.
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(path);

    // ASSERTION: exactly one visible top-level heading. getByRole finds it the
    // way a screen reader would, and Playwright's strict mode fails if there
    // are two, so this also guards the one-h1-per-page convention.
    // (Two routes are known defect D-4 and are checked in known-defects.spec.ts.)
    if (!ROUTES_WITHOUT_H1.has(path)) {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }

    // ASSERTION: the route's own title survived hydration, rather than falling
    // back to the site-wide default in src/root.jsx.
    await expect(page).not.toHaveTitle(ROOT_DEFAULT_TITLE);
    await expect(page).toHaveTitle(/\S/);
  });
}

test("a refresh on a nested route keeps the same page", async ({ page }) => {
  const path = "/deep-dives/gift-funds";
  await gotoHydrated(page, path);
  const heading = await page.getByRole("heading", { level: 1 }).textContent();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
  expect(new URL(page.url()).pathname).toBe(path);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading!);
});
