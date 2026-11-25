// Input handling: what the page does with what people actually type.
// NEGATIVE TESTING: out-of-range, empty and malformed input, and keyboard use.
// These are wiring rules that live in the input components, so unit tests on
// the math cannot see them.
import { test, expect } from "./support/test";
import { CalculatorPage } from "./support/calculator";

test.describe("down payment: percent and dollars stay in sync", () => {
  test("typing dollars updates the percent; changing the price resets to the percent", async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();
    await calc.set({ price: 350000 });
    const pct = page.getByLabel("Down Payment %", { exact: true });
    const dollars = page.getByLabel("Down Payment $", { exact: true });
    await dollars.click();
    await dollars.press("ControlOrMeta+a");
    await dollars.pressSequentially("35000");
    await dollars.blur();
    await expect(dollars).toHaveValue("35,000");
    await expect(pct).toHaveValue("10"); // 35,000 / 350,000
    await calc.set({ price: 400000 });
    await expect(pct).toHaveValue("10");
    await expect(dollars).toHaveValue("40,000"); // the dollar override is dropped, the percent kept
  });
});

test.describe("out-of-range values are clamped when the field is left", () => {
  test("rate above 15% becomes 15.000; a negative rate becomes 0.000", async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();
    await calc.set({ rates: { FHA: 20 } });
    await expect(calc.rateField("FHA")).toHaveValue("15.000");
    await calc.set({ rates: { FHA: -1 } });
    await expect(calc.rateField("FHA")).toHaveValue("0.000");
    await calc.expectNoBrokenNumbers();
  });

  test("down payment above 100% becomes 100", async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();
    await calc.set({ downPct: 150 });
    await expect(page.getByLabel("Down Payment %", { exact: true })).toHaveValue("100");
    await calc.expectNoBrokenNumbers();
  });
});

test.describe("formatting and empty fields", () => {
  test("a typed price is shown with thousands separators after leaving the field", async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();
    await calc.set({ price: 450000 });
    await expect(page.getByLabel("Home Price", { exact: true })).toHaveValue("450,000");
  });

  test("clearing the price never shows NaN, Infinity or undefined", async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();
    const price = page.getByLabel("Home Price", { exact: true });
    await price.click();
    await price.press("ControlOrMeta+a");
    await price.press("Backspace");
    await price.blur();
    await calc.expectNoBrokenNumbers();
  });
});

test.describe("D-7 regression: keyboard entry in comma-formatted fields", () => {
  // Tab selects the field's text; typing must replace it in every browser.
  // (Before the fix, Chrome and Edge appended: "350000" + "400000", clamped to $99,999,999.)
  for (const [label, typed, shown] of [["Home Price", "400000", "400,000"], ["Down Payment $", "20000", "20,000"]] as const) {
    test(`Tab into ${label} and type: the typed value replaces the old one`, async ({ page }) => {
      const calc = new CalculatorPage(page);
      await calc.open();
      const field = page.getByLabel(label, { exact: true });
      await field.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await page.keyboard.type(typed);
      await page.keyboard.press("Tab");
      await expect(field).toHaveValue(shown);
    });
  }

  test("editing at the caret still works (the fix only restores a whole-field selection)", async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();
    const price = page.getByLabel("Home Price", { exact: true });
    await price.click();
    await price.press("End");
    await price.press("Backspace");
    await price.pressSequentially("1");
    await price.blur();
    await expect(price).toHaveValue("350,001");
  });
});
