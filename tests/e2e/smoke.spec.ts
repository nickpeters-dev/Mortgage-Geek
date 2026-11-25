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
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

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

// Regression test for D-4 (fixed): the Jargon Decoder and Pre-Approval Checklist
// sections render as standalone pages AND inside the homepage. Standalone, their
// title must be the page's h1; on the homepage they must stay h2, under the
// homepage's own single h1.
test("D-4 regression: standalone section pages use h1, homepage sections stay h2", async ({ page }) => {
  for (const [path, title] of [["/jargon-decoder", "Jargon Decoder"], ["/pre-approval-checklist", "Pre-Approval Checklist"]]) {
    await gotoHydrated(page, path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  }
  await gotoHydrated(page, "/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: /Jargon Decoder|Pre-Approval Checklist/ })).toHaveCount(0);
});
