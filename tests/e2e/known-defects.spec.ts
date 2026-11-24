// One test per documented production defect, each marked test.fail(): it
// asserts the CORRECT behavior and is expected to fail until the defect is
// fixed. See QA_STRATEGY.md, "Known defects".
//
// When a defect is fixed, its test here passes, Playwright reports that
// unexpected pass as a failure, and whoever fixed it removes the test.fail()
// marker (and the matching entry in support/knownDefects.ts). The defect can't
// be fixed or reintroduced silently.
//
// This file uses plain @playwright/test, not ./support/test, on purpose: the
// shared fixture tolerates known-defect errors, and these tests need to see them.
import { test, expect } from "@playwright/test";
import { ROUTES_WITHOUT_H1 } from "./support/knownDefects";

const SAMPLE_ROUTES = ["/", "/calculator", "/deep-dives/gift-funds"];

for (const path of SAMPLE_ROUTES) {
  test(`D-2: ${path} hydrates without a server/client mismatch`, async ({ page }) => {
    test.fail(true, "Known defect D-2: escaped <style> content breaks hydration");

    const hydrationErrors: string[] = [];
    const onError = (text: string) => {
      if (/Minified React error #(418|423|425)/.test(text)) hydrationErrors.push(text);
    };
    page.on("console", (m) => m.type() === "error" && onError(m.text()));
    page.on("pageerror", (e) => onError(e.message));
    await page.route("**/api/**", (r) => r.fulfill({ status: 503, json: { success: false } }));

    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
    expect(hydrationErrors).toEqual([]);
  });
}

for (const path of ["/manifest.json", "/service-worker.js"]) {
  test(`D-3: ${path} is served (PWA install and offline support)`, async ({ request }) => {
    test.fail(true, "Known defect D-3: file is at the repo root, not in public/, so it is not deployed");
    expect((await request.get(path)).status()).toBe(200);
  });
}

for (const path of ROUTES_WITHOUT_H1) {
  test(`D-4: ${path} has a top-level heading`, async ({ page }) => {
    test.fail(true, "Known defect D-4: main title is an <h2>, no <h1>");
    await page.route("**/api/**", (r) => r.fulfill({ status: 503, json: { success: false } }));
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 2000 });
  });
}
