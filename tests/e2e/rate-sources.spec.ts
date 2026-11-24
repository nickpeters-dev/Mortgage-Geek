// Where the calculator's starting rates come from, and what the visitor is told.
// CHARACTERIZATION tests: they pin down CURRENT behavior (2026-11-24) so the
// rate-source review (QA_RATE_SOURCES.md) works from observed facts, and so any
// change to this behavior is deliberate. Tests marked "R-n" document a finding
// under review: when the behavior is changed on purpose, that test is
// rewritten to assert the new, approved behavior. It is not deleted.
//
// Expected rates are computed by hand from the documented rule (round to the
// nearest 0.125%, then add 0.125%), not by calling the app's roundRate():
//
//   API value   / 0.125    nearest   x 0.125   + 0.125   shown
//   6.90        55.20      55        6.875     7.000     Conventional 30-yr
//   6.05        48.40      48        6.000     6.125     Conventional 15-yr
//   6.55        52.40      52        6.500     6.625     FHA (and USDA, which follows FHA)
//   6.30        50.40      50        6.250     6.375     VA
//
// Every value was chosen so its result differs from the built-in defaults
// (6.750 conventional, 6.000 15-yr, 6.250 FHA/VA/USDA). With the shared
// fixture, FHA 6.10 also rounds to 6.250, so a test could not tell live from
// fallback for FHA. A test value that cannot distinguish the outcomes it is
// meant to separate is a blind spot.
//
// CONCEPT: controlling time without sleeping. "Slow API" tests hold the mocked
// response until the test releases it (a promise the route handler awaits),
// so "the visitor acted before the rates arrived" happens on every run, on any
// machine. A fixed wait would be slower and still flaky.
import { test, expect, gotoHydrated } from "./support/test";
import type { Page, Route } from "@playwright/test";

const LIVE = {
  success: true,
  date: "Tuesday, January 6, 2026",
  source: "Mortgage News Daily",
  rates: [
    { label: "30-Year Fixed", rate: "6.90", change: null, icon: "🏠" },
    { label: "15-Year Fixed", rate: "6.05", change: null, icon: "⚡" },
    { label: "30-Year FHA", rate: "6.55", change: null, icon: "🏛" },
    { label: "30-Year VA", rate: "6.30", change: null, icon: "🎖" },
  ],
};
const LIVE_SHOWN = { Conventional: "7.000", FHA: "6.625", VA: "6.375", USDA: "6.625" };
const DEFAULTS_SHOWN = { Conventional: "6.750", FHA: "6.250", VA: "6.250", USDA: "6.250" };

const PROGRAMS = ["Conventional", "FHA", "VA", "USDA"] as const;
const rateField = (page: Page, program: string) => page.getByLabel(program, { exact: true });
const LIVE_BADGE = /Live( rates loaded)? · /;
const SOURCE_CLAIM = "National averages via Mortgage News Daily";
const WAITING_HINT = "they'll auto-populate when live data loads";

async function expectRates(page: Page, shown: Record<string, string>) {
  for (const p of PROGRAMS) await expect(rateField(page, p), p).toHaveValue(shown[p]);
}

// Holds /api/rates until release() is called. Registered after the shared
// fixture's routes, so it takes precedence (newest route wins).
async function gateRates(page: Page, body: object) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let requested!: () => void;
  const wasRequested = new Promise<void>((r) => (requested = r));
  await page.route("**/api/rates", async (route: Route) => {
    requested();
    await gate;
    await route.fulfill({ json: body });
  });
  return { release, wasRequested };
}

test.describe("calculator: live rates", () => {
  test.use({ ratesResponse: LIVE });

  test("live rates fill every program, rounded up to the next 1/8 plus 1/8, with the source date", async ({ page }) => {
    await gotoHydrated(page, "/calculator");
    await expectRates(page, LIVE_SHOWN);
    await expect(page.getByText(LIVE_BADGE)).toContainText("Tuesday, January 6, 2026");
    await expect(page.getByText(WAITING_HINT)).toHaveCount(0);
  });

  test("switching to a 15-year term uses the live 15-year rate", async ({ page }) => {
    await gotoHydrated(page, "/calculator");
    await expect(rateField(page, "Conventional")).toHaveValue("7.000");
    await page.getByLabel("Loan Term").selectOption("15");
    await expect(rateField(page, "Conventional")).toHaveValue("6.125");
  });

  test("a rate passed in the link (?program=FHA&rate=7.25) is kept when live rates arrive", async ({ page }) => {
    await gotoHydrated(page, "/calculator?program=FHA&rate=7.25");
    await expect(rateField(page, "Conventional")).toHaveValue("7.000"); // live rates have arrived
    await expect(rateField(page, "FHA")).toHaveValue("7.250");
  });

  test("R-4: a rate the visitor typed before live rates arrived is overwritten", async ({ page }) => {
    const { release, wasRequested } = await gateRates(page, LIVE);
    await gotoHydrated(page, "/calculator");
    await wasRequested;
    await rateField(page, "FHA").fill("5.5");
    await rateField(page, "FHA").blur();
    await expect(rateField(page, "FHA")).toHaveValue("5.500");
    release();
    // Current behavior: the live rate replaces the visitor's 5.500 without notice.
    await expect(rateField(page, "FHA")).toHaveValue("6.625");
  });

  test("R-4: changing the term replaces a typed conventional rate with the live rate", async ({ page }) => {
    await gotoHydrated(page, "/calculator");
    await expect(rateField(page, "Conventional")).toHaveValue("7.000");
    await rateField(page, "Conventional").fill("5.875");
    await rateField(page, "Conventional").blur();
    await page.getByLabel("Loan Term").selectOption("15");
    await page.getByLabel("Loan Term").selectOption("30");
    await expect(rateField(page, "Conventional")).toHaveValue("7.000");
  });
});

test.describe("calculator: rates unavailable", () => {
  test.describe("API answers 500 (production's own error response)", () => {
    test.use({ ratesResponse: null, allowedConsoleErrors: [/^HTTP 500 \S+\/api\/rates$/] });

    test("R-1: falls back to built-in rates; nothing says they are not live", async ({ page }) => {
      await gotoHydrated(page, "/calculator");
      await expectRates(page, DEFAULTS_SHOWN);
      await expect(page.getByText(LIVE_BADGE)).toHaveCount(0);
      // Current behavior: the page still credits the defaults to Mortgage News
      // Daily, and promises live data that will never load.
      await expect(page.getByText(SOURCE_CLAIM)).toBeVisible();
      await expect(page.getByText(WAITING_HINT)).toBeVisible();
    });

    test("R-2: a 15-year term keeps the 30-year default (6.750); the 15-year default is unused", async ({ page }) => {
      await gotoHydrated(page, "/calculator?term=15");
      await expect(page.getByLabel("Loan Term")).toHaveValue("15");
      await expect(rateField(page, "Conventional")).toHaveValue("6.750");
    });
  });

  test("network failure: same fallback as a 500", async ({ page }) => {
    await page.route("**/api/rates", (route) => route.abort("connectionfailed"));
    await gotoHydrated(page, "/calculator");
    await expectRates(page, DEFAULTS_SHOWN);
    await expect(page.getByText(LIVE_BADGE)).toHaveCount(0);
    await expect(page.getByText(WAITING_HINT)).toBeVisible();
  });

  test("a non-JSON answer (e.g. a platform error page) falls back without breaking the page", async ({ page }) => {
    await page.route("**/api/rates", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>An error occurred</body></html>" }),
    );
    await gotoHydrated(page, "/calculator");
    await expectRates(page, DEFAULTS_SHOWN);
    await expect(page.getByText(LIVE_BADGE)).toHaveCount(0);
  });

  test("a visitor can still type their own rate while live rates are unavailable", async ({ page }) => {
    await page.route("**/api/rates", (route) => route.abort("connectionfailed"));
    await gotoHydrated(page, "/calculator");
    await rateField(page, "VA").fill("5.875");
    await rateField(page, "VA").blur();
    await expect(rateField(page, "VA")).toHaveValue("5.875");
  });
});

test.describe("calculator: partial and stale data", () => {
  test.describe("only the 30-year fixed rate parsed", () => {
    test.use({ ratesResponse: { ...LIVE, rates: [LIVE.rates[0]] } });

    test("R-3: FHA, VA and USDA keep built-in rates under a 'Live' badge", async ({ page }) => {
      await gotoHydrated(page, "/calculator");
      await expect(rateField(page, "Conventional")).toHaveValue("7.000");
      await expect(page.getByText(LIVE_BADGE)).toBeVisible();
      for (const p of ["FHA", "VA", "USDA"]) await expect(rateField(page, p), p).toHaveValue("6.250");
    });
  });

  test.describe("a response dated almost a year earlier", () => {
    test.use({ ratesResponse: { ...LIVE, date: "Monday, January 6, 2025" } });

    test("R-5: shown as live with no age check", async ({ page }) => {
      await gotoHydrated(page, "/calculator");
      await expectRates(page, LIVE_SHOWN);
      await expect(page.getByText(LIVE_BADGE)).toContainText("Monday, January 6, 2025");
    });
  });
});

test.describe("PreQual and Cash to Close share the fallback logic", () => {
  test.describe("live rates", () => {
    test.use({ ratesResponse: LIVE });

    test("R-6: PreQual keeps the built-in USDA rate under a 'Live' badge (the calculator uses FHA's)", async ({ page }) => {
      await gotoHydrated(page, "/prequal");
      await expect(page.getByText(LIVE_BADGE)).toBeVisible();
      await expect(rateField(page, "FHA")).toHaveValue("6.625");
      // PreQual looks for a "usda" entry, which /api/rates never returns.
      await expect(rateField(page, "USDA")).toHaveValue("6.250");
    });

    test("Cash to Close shows live rates with a LIVE tag and the source date", async ({ page }) => {
      await gotoHydrated(page, "/cash-to-close");
      await expect(rateField(page, "Conventional Rate")).toHaveValue("7.000");
      await expect(page.getByText("LIVE", { exact: true })).toBeVisible();
      await expect(page.getByText("Tuesday, January 6, 2026")).toBeVisible();
    });
  });

  test.describe("API answers 500", () => {
    test.use({ ratesResponse: null, allowedConsoleErrors: [/^HTTP 500 \S+\/api\/rates$/] });

    test("R-1: PreQual falls back to built-in rates, still credited to Mortgage News Daily", async ({ page }) => {
      await gotoHydrated(page, "/prequal");
      await expectRates(page, DEFAULTS_SHOWN);
      await expect(page.getByText(LIVE_BADGE)).toHaveCount(0);
      await expect(page.getByText(SOURCE_CLAIM)).toBeVisible();
      await expect(page.getByText(WAITING_HINT)).toBeVisible();
    });

    test("R-1: Cash to Close falls back to the built-in rate with no message at all", async ({ page }) => {
      await gotoHydrated(page, "/cash-to-close");
      await expect(rateField(page, "Conventional Rate")).toHaveValue("6.750");
      await expect(page.getByText("Loading today's rates...")).toHaveCount(0);
      await expect(page.getByText("LIVE", { exact: true })).toHaveCount(0);
    });
  });
});
