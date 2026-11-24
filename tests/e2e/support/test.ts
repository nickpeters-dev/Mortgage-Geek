// Shared test setup for every browser spec. Specs import { test, expect } from
// here instead of from '@playwright/test', so each test gets these guarantees
// without asking for them:
//
//   1. /api/rates is answered from tests/e2e/fixtures/rates.json, so default
//      rates are the same on every run instead of whatever the market did today.
//   2. Any other /api/* call fails loudly (501) instead of hanging or reaching a
//      real backend. A new endpoint has to be mocked on purpose.
//   3. A console error, uncaught exception, or failed request (HTTP 400+)
//      fails the test, unless the test lists it in `allowedConsoleErrors` or a
//      documented known defect explains it AND the page shows that defect's
//      evidence (support/knownDefects.ts). Tests that relied on an allowance
//      carry a "known-defect" annotation in the report.
//
// CONCEPT: a fixture is a value a test asks for by name ({ page }, { request }).
// Playwright builds it before the test, hands it in, and tears it down after,
// even if the test fails. Overriding `page` below wraps the built-in one: code
// before `await use(page)` is setup, code after it is teardown.
//
// CONCEPT: test isolation. Every test gets a new browser context: an empty
// localStorage, no cookies, no cache. Nothing one test does can leak into the
// next, so tests can run in parallel and in any order.
import { test as base, expect, type Page, type Response } from "@playwright/test";
import { readFileSync } from "node:fs";
import { explainByKnownDefect, type ServedDocument } from "./knownDefects";

const defaultRates = JSON.parse(
  readFileSync(new URL("../fixtures/rates.json", import.meta.url), "utf8"),
);

type Options = {
  // The /api/rates body. `null` answers with the production error response
  // (HTTP 500, success: false) to exercise the fallback path.
  ratesResponse: object | null;
  // Console errors a specific test expects (e.g. the rates-outage test).
  allowedConsoleErrors: RegExp[];
};

export const test = base.extend<Options>({
  // Option fixtures: defaults here, overridable per file or describe block with
  //   test.use({ ratesResponse: null })
  ratesResponse: [defaultRates, { option: true }],
  allowedConsoleErrors: [[], { option: true }],

  page: async ({ page, ratesResponse, allowedConsoleErrors, baseURL }, use, testInfo) => {
    // Routes are matched newest first, so register the catch-all before the
    // specific mock.
    await page.route("**/api/**", (route) =>
      route.fulfill({ status: 501, body: `Unmocked API call in test: ${route.request().url()}` }),
    );
    await page.route("**/api/rates", (route) =>
      ratesResponse === null
        ? route.fulfill({ status: 500, json: { success: false, error: "Unable to fetch current rates. Please try again later." } })
        : route.fulfill({ status: 200, json: ratesResponse }),
    );

    const errors: string[] = [];
    page.on("console", (msg) => {
      // The browser's "Failed to load resource" message has no URL in it; the
      // response listener below records the same failure WITH its URL instead.
      if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource")) {
        errors.push(`console.error: ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => errors.push(`uncaught exception: ${err.message}`));
    // Keep the HTML of every page the test loads: known-defect allowances only
    // apply when that page shows the defect's own evidence.
    const documents: Promise<ServedDocument | null>[] = [];
    page.on("response", (res) => {
      if (res.status() >= 400) errors.push(`HTTP ${res.status()} ${res.url()}`);
      if (res.request().resourceType() === "document" && res.status() === 200) {
        documents.push(res.text().then((html) => ({ url: res.url(), html }), () => null));
      }
    });

    await use(page);

    // Teardown: runs after the test body, pass or fail.
    const ctx = { baseURL: baseURL!, documents: (await Promise.all(documents)).filter((d) => d !== null) };
    const unexpected: string[] = [];
    const usedDefects = new Set<string>();
    for (const e of errors) {
      if (allowedConsoleErrors.some((re) => re.test(e))) continue;
      const defect = explainByKnownDefect(e, ctx);
      if (defect) usedDefects.add(defect);
      else unexpected.push(e);
    }
    // Shows in the HTML report which tests pass only thanks to a known defect.
    for (const id of usedDefects) testInfo.annotations.push({ type: "known-defect", description: id });

    expect(unexpected, "Console errors, uncaught exceptions, or failed requests during the test").toEqual([]);
  },
});

export { expect };

// Navigate, then wait until React has hydrated the prerendered HTML.
//
// WHY: the server sends finished HTML, so the page LOOKS ready before React has
// attached any event handlers. Typing during that gap can be lost. src/root.jsx
// sets <html data-hydrated="true"> in its mount effect, which runs after every
// page's own mount effects, so after this resolves the page is interactive and
// its startup work (rate fetch, saved state, desktop/mobile layout) is done.
export async function gotoHydrated(page: Page, path: string): Promise<Response | null> {
  const response = await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
  return response;
}
