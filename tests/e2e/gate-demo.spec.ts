// DEMONSTRATION ONLY. DO NOT MERGE. Delete this branch after the demo.
//
// A deliberately failing test, to show that the main-branch ruleset blocks a
// pull request whose required checks fail. It changes no application code, so
// nothing about the site is affected; the branch deploys only as a preview.
import { test, expect } from "./support/test";

test("quality gate demo: this test fails on purpose", async ({ page }) => {
  await page.goto("/calculator");
  // The real heading is "Mortgage Calculator". The wrong value is intentional.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Deliberately wrong heading");
});
