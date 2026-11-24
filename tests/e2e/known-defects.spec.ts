// Characterization tests for open production defects (QA_DEFECT_LOG.md). Each
// asserts the defect's EXACT documented signature, so it fails when the defect
// is fixed (prompting removal of this test and its allowance in
// support/knownDefects.ts) and also when the defect changes shape.
//
// Why not test.fail(): it inverts the result of the whole test, so ANY failure
// (a timeout, an unrelated crash) would count as "the defect is still there".
// These tests only pass when the specific documented behavior is observed.
//
// Plain @playwright/test on purpose: the shared fixture tolerates known-defect
// errors, and these tests need to see them.
//
// D-1 (NUL bytes) is characterized per route in production-routing.http.spec.ts.
// D-4 (no <h1>) is characterized per route in smoke.spec.ts.
import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { hasD2Signature } from "./support/knownDefects";

for (const path of ["/", "/calculator", "/deep-dives/gift-funds"]) {
  test(`D-2 still present as documented on ${path}: escaped <style>, root falls back to client rendering`, async ({ page }) => {
    const codes = new Set<string>();
    const collect = (text: string) => {
      for (const m of text.matchAll(/Minified React error #(\d+)/g)) codes.add(m[1]);
    };
    page.on("console", (m) => m.type() === "error" && collect(m.text()));
    page.on("pageerror", (e) => collect(e.message));
    await page.route("**/api/**", (r) => r.fulfill({ status: 503, json: { success: false } }));

    // Served HTML fetched over plain HTTP, not read back from the browser
    // (WebKit can evict it once React replaces the document; flaky in CI).
    const served = await (await page.request.get(path)).text();
    expect(hasD2Signature(served), "served HTML has HTML entities inside <style>").toBe(true);
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
    // #423: "the entire root will switch to client rendering". The defining symptom.
    expect([...codes].sort(), "React hydration error codes").toEqual(["418", "423", "425"]);
  });
}

test("D-3b still present as documented: /service-worker.js is not built or served", async ({ request }) => {
  expect(existsSync("service-worker.js"), "source file at the repo root").toBe(true);
  expect(existsSync("build/client/service-worker.js"), "file in the build output").toBe(false);
  expect((await request.get("/service-worker.js")).status()).toBe(404);
});
