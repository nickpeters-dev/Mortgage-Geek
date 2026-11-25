// Page object for /calculator: the ONE place that knows how the page is built.
// Specs say what to do ("set the price", "read the FHA total"); this file knows
// how, in both layouts:
//
//   desktop (>= 1100px)  compact cards (role="button"); the breakdown lives in a
//                        detail panel (section "FHA payment details") for the
//                        selected card only.
//   mobile               full cards (role="group") with the breakdown inside.
//
// CONCEPT: a page object trades a little indirection for one-line fixes. When
// the markup changes, this file changes and the specs do not.
//
// Locators, in order of preference: role + accessible name, label, then a
// test id only for a computed value with no role or label (the card total).
import { expect, type Locator, type Page } from "@playwright/test";
import { gotoHydrated } from "./test";

export const PROGRAMS = ["Conventional", "FHA", "VA", "USDA"] as const;
export type Program = (typeof PROGRAMS)[number];

export type CalcInputs = {
  price?: number;
  downPct?: string | number;
  term?: 15 | 30;
  rates?: Partial<Record<Program, string | number>>;
  taxes?: number;
  insurance?: number;
};

export class CalculatorPage {
  constructor(readonly page: Page) {}

  get isDesktop() {
    return (this.page.viewportSize()?.width ?? 0) >= 1100;
  }

  // Waits for hydration AND for the rate request to settle: a late rate response
  // replaces typed rates (QA_RATE_SOURCES.md R-4), so inputs are only typed
  // after the "Live" badge is shown.
  async open(path = "/calculator") {
    await gotoHydrated(this.page, path);
    await expect(this.page.getByText(/Live( rates loaded)? · /)).toBeVisible();
  }

  // Type into a field the way a mouse user does: click, select all, type, leave
  // the field (the page formats and clamps values on blur).
  //
  // Not locator.fill(): in Chromium, focusing a comma-formatted field rewrites
  // its text ("350,000" -> "350000"), which drops the selection, so new digits
  // are appended (defect D-7, characterized in calculator.inputs.spec.ts). Using
  // fill() here would make every calculation test fail on D-7 instead of
  // checking the math.
  private async type(field: Locator, value: string | number) {
    await field.click();
    await field.press("ControlOrMeta+a");
    await field.pressSequentially(String(value));
    await field.blur();
  }

  rateField(program: Program) {
    // type="number" -> role "spinbutton". Not getByLabel: the cards are also
    // labelled by program name.
    return this.page.getByRole("spinbutton", { name: program, exact: true });
  }

  // Order matters: a price change recomputes taxes and insurance and resets the
  // dollar down payment, so price goes first and escrow last.
  async set(inputs: CalcInputs) {
    const p = this.page;
    if (inputs.price !== undefined) await this.type(p.getByLabel("Home Price", { exact: true }), inputs.price);
    if (inputs.downPct !== undefined) await this.type(p.getByLabel("Down Payment %", { exact: true }), inputs.downPct);
    if (inputs.term !== undefined) await p.getByLabel("Loan Term").selectOption(String(inputs.term));
    for (const [program, rate] of Object.entries(inputs.rates ?? {})) {
      await this.type(this.rateField(program as Program), rate!);
    }
    if (inputs.taxes !== undefined) await this.type(p.getByLabel("Monthly Amount", { exact: true }), inputs.taxes);
    if (inputs.insurance !== undefined) await this.type(p.getByLabel("Homeowners Ins. (est.)", { exact: true }), inputs.insurance);
  }

  // The result cards, as opposed to the program show/hide toggles at the top,
  // which carry the same names.
  get results(): Locator {
    return this.page.getByRole("group", { name: "Monthly payment by loan program" });
  }

  card(program: Program): Locator {
    const name = { name: program, exact: true };
    return this.results.getByRole("button", name).or(this.results.getByRole("group", name));
  }

  total(program: Program): Locator {
    return this.card(program).getByTestId("monthly-total");
  }

  // Where this program's breakdown rows are shown. On desktop that means
  // selecting its card first, which is what a visitor would do.
  async breakdown(program: Program): Promise<Locator> {
    if (!this.isDesktop) return this.card(program);
    const card = this.card(program);
    if ((await card.getAttribute("aria-pressed")) !== "true") await card.click();
    await expect(card).toHaveAttribute("aria-pressed", "true");
    return this.page.getByRole("region", { name: `${program} payment details` });
  }

  // The amount on the row whose label matches, e.g. row(fha, "MIP (0.55%)").
  // Each row is a label followed by its amount, so the amount is the next span.
  row(scope: Locator, label: string | RegExp): Locator {
    return scope.getByText(label, { exact: typeof label === "string" }).first().locator("xpath=following-sibling::span[1]");
  }

  async setVaUsage(usage: "first" | "subsequent" | "exempt") {
    const scope = await this.breakdown("VA");
    await scope.getByLabel("VA Eligibility").selectOption(usage);
  }

  // D5: a cheap net under every calculator test. A NaN, Infinity or undefined
  // anywhere in the visible text means some value broke on its way to the screen.
  async expectNoBrokenNumbers() {
    await expect(this.page.locator("body")).not.toContainText(/\bNaN\b|Infinity|undefined/);
  }
}
