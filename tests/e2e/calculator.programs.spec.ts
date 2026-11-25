// Loan program rules as the visitor sees them: eligibility, mortgage insurance
// labels and amounts, VA usage, term restrictions.
//
// CONCEPT: boundary value analysis (BVA). Bugs cluster at the edges of a rule
// (">=" written as ">", a tier off by one). So each rule is tested ON the edge
// and just below it, not somewhere in the middle:
//
//   rule                        edge     just below   source
//   Conventional minimum        3%       2.99%        Fannie Mae / Freddie Mac 97% LTV
//   FHA minimum                 3.5%     3.49%        HUD (580+ credit score)
//   FHA annual MIP 0.55 -> 0.50 5%       4.99%        HUD ML 2023-05 (95.00% LTV is not "> 95%")
//   FHA MIP for life -> 11 yrs  10%      9.99%        HUD ML 2023-05 (90.00% LTV)
//   PMI tiers (site assumption) 5/10/20% 4.99/9.99/19.99%
//   VA funding fee tiers        5%/10%   4.99/9.99%   va.gov (effective 2023-04-07)
//   FHA MIP, high balance       base $726,200 vs $726,201.60   HUD ML 2023-05 (D-6)
//   FHA MIP, 15-year LTV bands  10% / 9.99%; 22% / 21.99%       HUD ML 2023-05 (D-5)
//
// Expected totals come from tests/e2e/fixtures/expected.json (Python reference).
import { test, expect } from "./support/test";
import { CalculatorPage, PROGRAMS, type Program } from "./support/calculator";
import { readFileSync } from "node:fs";

type Exp = { eligible: boolean; reason?: string; total?: string; miLabel?: string | null; upfrontLabel?: string | null; knownDefect?: { app: { total: string } } };
type Scenario = { id: string; price: number; downPct: string; term: 15 | 30; rates: Record<Program, string>; vaUsage: string; taxes: number; insurance: number; expected: Record<Program, Exp> };
const { scenarios } = JSON.parse(readFileSync(new URL("./fixtures/expected.json", import.meta.url), "utf8")) as { scenarios: Scenario[] };
const get = (id: string) => scenarios.find((s) => s.id === id)!;

async function openWith(page: import("@playwright/test").Page, s: Scenario) {
  const calc = new CalculatorPage(page);
  await calc.open();
  await calc.set({ price: s.price, downPct: s.downPct, term: s.term, rates: s.rates, taxes: s.taxes, insurance: s.insurance });
  return calc;
}

test.describe("down payment boundaries ($400,000, 30 years)", () => {
  for (const down of ["2.99", "3", "3.49", "3.5", "4.99", "5", "9.99", "10", "19.99", "20"]) {
    test(`${down}% down: eligibility, mortgage insurance label and total for every program`, async ({ page }) => {
      const s = get(`BVA-${down}`);
      const calc = await openWith(page, s);
      for (const program of PROGRAMS) {
        const e = s.expected[program];
        const card = calc.card(program);
        if (!e.eligible) {
          await expect(card, `${program} at ${down}%`).toContainText("Ineligible");
          await expect(card).toContainText(e.reason!);
          continue;
        }
        await expect(calc.total(program), `${program} total at ${down}%`).toHaveText(e.knownDefect?.app.total ?? e.total!);
      }
      // Mortgage insurance labels: checked on the breakdown for the programs that have one.
      for (const program of ["Conventional", "FHA"] as const) {
        const e = s.expected[program];
        if (!e.eligible) continue;
        const scope = await calc.breakdown(program);
        if (e.miLabel) await expect(scope.getByText(e.miLabel, { exact: true }), `${program} MI label`).toBeVisible();
        else await expect(scope.getByText(/^PMI \(/), "no PMI line at 20% down").toHaveCount(0);
      }
      await calc.expectNoBrokenNumbers();
    });
  }

  test("FHA mortgage insurance duration note changes at exactly 10% down", async ({ page }) => {
    for (const [down, note] of [["9.99", "MIP for life of loan"], ["10", "MIP removable after 11 years"]] as const) {
      const calc = await openWith(page, get(`BVA-${down}`));
      await expect(calc.card("FHA").getByText(note)).toBeVisible();
    }
  });
});

test.describe("FHA annual MIP boundaries (HUD ML 2023-05; regressions for D-5 and D-6)", () => {
  for (const id of ["FHA-base-726200", "FHA-base-726201", "FHA-15y-9.99", "FHA-15y-10", "FHA-15y-hb-21.99", "FHA-15y-hb-22"]) {
    test(`${id}: MIP label and FHA total`, async ({ page }) => {
      const s = get(id);
      const calc = await openWith(page, s);
      const e = s.expected.FHA;
      await expect(calc.total("FHA")).toHaveText(e.total!);
      const scope = await calc.breakdown("FHA");
      await expect(scope.getByText(e.miLabel!, { exact: true })).toBeVisible();
    });
  }
});

test.describe("VA funding fee by usage (0% down, $400,000)", () => {
  for (const usage of ["first", "subsequent", "exempt"] as const) {
    test(`${usage} use: funding fee line and total`, async ({ page }) => {
      const s = get(`VA-${usage}`);
      const calc = await openWith(page, s);
      await calc.setVaUsage(usage);
      const e = s.expected.VA;
      await expect(calc.total("VA")).toHaveText(e.total!);
      const scope = await calc.breakdown("VA");
      if (e.upfrontLabel) await expect(scope.getByText(`+ ${e.upfrontLabel}`, { exact: true })).toBeVisible();
      else await expect(scope.getByText("Funding Fee Waived", { exact: true })).toBeVisible();
      // VA never has a monthly mortgage insurance line (C2).
      await expect(scope.getByText(/^(PMI|MIP|Annual Fee) \(/)).toHaveCount(0);
    });
  }
});

test("USDA is 30-year only: a 15-year term makes it ineligible and leaves the others eligible", async ({ page }) => {
  const calc = new CalculatorPage(page);
  await calc.open();
  await page.getByLabel("Loan Term").selectOption("15");
  await expect(calc.card("USDA")).toContainText("Ineligible");
  await expect(calc.card("USDA")).toContainText("USDA 30-Year Only");
  for (const program of ["Conventional", "FHA", "VA"] as const) await expect(calc.total(program)).toHaveText(/^\$[\d,]+$/);
});
