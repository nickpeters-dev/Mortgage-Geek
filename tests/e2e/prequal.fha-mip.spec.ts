// D-6 regression for PreQual: FHA annual MIP steps from 0.50% to 0.70% when the
// base loan passes $726,200 (HUD ML 2023-05, 10% down = 90% LTV, 30 years).
// PreQual SOLVES for the loan, so the rate depends on its own answer. Three
// cases, each well inside its income band (bands measured 2026-11-25 with the
// fixture rates and Nashville/Davidson taxes):
//
//   income   expected
//   11,800   below the threshold: MIP 0.5%
//   12,300   pinned at the threshold: one dollar more would move into the 0.70%
//            tier and break the DTI limit, so the maximum loan is $726,199
//            (price floor(726,200 / 0.9) = 806,888; loan 806,888 x 0.9)
//   12,800   above the threshold: MIP 0.7%
//
// Full PreQual reference values (DTI, purchasing power) come in the PreQual
// spec; this file only guards the D-6 fix.
//
// Nashville/Davidson is chosen explicitly: PreQual's default location is reset
// on load (D-8), and its FHA limit there is $1,029,250, so the threshold is reachable.
import { test, expect, gotoHydrated } from "./support/test";
import type { Page } from "@playwright/test";

// Desktop: FHA's result button opens a details region. Mobile: every program's
// details are already shown as one text block starting "FHA · Max Purchase"
// (no button or region there yet; see the PreQual review).
async function fhaDetails(page: Page, income: number) {
  await gotoHydrated(page, `/prequal?income=${income}&debts=0&down=10`);
  await expect(page.getByText(/Live( rates loaded)? · /)).toBeVisible();
  await page.getByRole("combobox", { name: "County or metro tax area" }).selectOption({ label: "Nashville/Davidson (0.95%)" });
  const results = page.getByRole("region", { name: "Loan results" });
  if (await results.count()) {
    await results.getByRole("button", { name: /^(✓ Selected )?(★ Most Power )?FHA / }).click();
    return page.getByRole("region", { name: "FHA pre-qualification details" });
  }
  // The innermost block that starts with FHA's heading and holds its loan details.
  return page.locator("div").filter({ hasText: /^FHA · Max Purchase/ }).filter({ hasText: "Loan Amount" }).last();
}

test("below $726,200: standard 0.5% MIP", async ({ page }) => {
  const d = await fhaDetails(page, 11800);
  await expect(d).toContainText("MIP (0.5%)");
});

test("between the two answers: the maximum loan is pinned at the threshold", async ({ page }) => {
  const d = await fhaDetails(page, 12300);
  await expect(d).toContainText(/Loan Amount\s*\$726,199/);
  await expect(d).toContainText("$806,888");
  await expect(d).toContainText("MIP (0.5%)");
});

test("above $726,200: high-balance 0.7% MIP, and the price is affordable AT that rate", async ({ page }) => {
  const d = await fhaDetails(page, 12800);
  await expect(d).toContainText("MIP (0.7%)");
  await expect(d).not.toContainText(/Loan Amount\s*\$726,199/);

  // INVARIANT: the reported maximum must actually fit the reported maximum
  // payment when priced at its own MIP rate. A label check alone passed when
  // the price was solved at 0.5% but labelled 0.7% (overstated buying power).
  const text = (await d.innerText()).replace(/\s+/g, " ");
  const money = (re: RegExp) => Number(text.match(re)![1].replace(/,/g, ""));
  const price = money(/\$([\d,]+)/); // the first amount in the block is the max price
  const loan = money(/Loan Amount \$([\d,]+)/);
  const maxPayment = money(/Max Housing Payment \$([\d,]+)/);
  const i = 6.25 / 100 / 12; // FHA rate from the rates fixture (6.10 -> 6.250)
  const totalLoan = loan * 1.0175; // UFMIP 1.75% financed (HUD)
  const pi = (totalLoan * i) / (1 - (1 + i) ** -360);
  const mip = (loan * 0.007) / 12; // HUD: 0.70% above $726,200 at 90% LTV
  const taxes = (price * 0.0095) / 12; // Nashville/Davidson 0.95% (site tax table)
  const insurance = (price * 0.0035) / 12; // PreQual's 0.35% insurance assumption
  // $5 is PreQual's own solver tolerance; displayed values are whole dollars.
  expect(pi + mip + taxes + insurance, `payment at $${price}`).toBeLessThanOrEqual(maxPayment + 5);
});
