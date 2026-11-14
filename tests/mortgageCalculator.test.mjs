// Mortgage calculator regression tests. Run with `npm test`.
//
// Where the expected values come from (none are produced by the code under test):
//   - Payment, schedule, and APR literals: tests/reference/expected_values.py,
//     an independent Python implementation of the textbook definitions using
//     exact decimal arithmetic. Re-run it if a literal is ever questioned.
//   - Program fees and mortgage insurance: the dated public sources listed in
//     SOURCES below. A test that fails here means the code and the cited rule
//     no longer agree; it does not by itself say which one is right.
//   - Dollar figures in the program tests are hand arithmetic, shown inline.
//
// What these tests do not cover is listed in the README under "Testing and
// verification".
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateAmortData, calculateAPR, formatPayoff } from "../src/utils/math.js";
import {
  resolveProgram,
  conventionalMiRate,
  fhaMiRate,
  vaFeeRate,
  USDA_MI_RATE,
  monthlyPI,
  monthlyMI,
} from "../src/utils/mortgageMath.js";
import {
  computeMonthlyPayment,
  priceScaledEscrow,
  solvePriceForPayment,
} from "../src/components/calculator/paymentModel.js";

// Dated references for the financing assumptions pinned below (checked 2026-11-14).
const SOURCES = {
  fha: "HUD Mortgagee Letter 2023-05 (Feb 22, 2023; case numbers endorsed on or after Mar 20, 2023), Appendix 1.0",
  va: "va.gov funding fee chart, rates effective Apr 7, 2023 (page last updated Oct 5, 2026)",
  usda: "USDA Rural Development FY 2027 fee notice (Sep 16, 2026): 1.00% upfront, 0.35% annual",
  hpa: "Homeowners Protection Act of 1998 (12 U.S.C. 4902): automatic termination at 78% of original value",
};

const near = (actual, expected, tol, label = "") =>
  assert.ok(Math.abs(actual - expected) <= tol, `${label} expected ${expected} within ${tol}, got ${actual}`);

const allFinite = (obj) => Object.values(obj).every((v) => typeof v !== "number" || Number.isFinite(v));

describe("principal and interest: known answers", () => {
  // [loan, annual rate %, term years, expected payment] from expected_values.py
  const cases = [
    [300000, 6.5, 30, 1896.2],
    [300000, 6.5, 15, 2613.32],
    [200000, 7, 30, 1330.6],
    [400000, 3, 30, 1686.42],
    [250000, 10, 30, 2193.93],
  ];
  for (const [loan, rate, term, expected] of cases) {
    test(`$${loan.toLocaleString("en-US")} at ${rate}% over ${term} years is $${expected}`, () => {
      near(generateAmortData(loan, rate, term).monthly, expected, 0.005);
      near(monthlyPI(loan, rate, term), expected, 0.005, "monthlyPI");
    });
  }
});

describe("valid boundary inputs (allowed by the calculator's own controls)", () => {
  test("0% rate: payment is principal divided by months, with no interest", () => {
    const a = generateAmortData(360000, 0, 30);
    near(a.monthly, 1000, 1e-9);
    assert.equal(a.totalInterest, 0);
    assert.equal(a.payoffMonth, 360);
    assert.equal(a.data.at(-1).balance, 0);
  });

  test("15% rate (the rate input's maximum) matches the reference", () => {
    near(generateAmortData(300000, 15, 30).monthly, 3793.33, 0.005);
  });

  test("100% down (a $0 loan) gives a $0 payment and no NaN anywhere", () => {
    const t = resolveProgram({ program: "Conventional", price: 300000, downPct: 100 });
    assert.equal(t.baseLoan, 0);
    assert.equal(t.loan, 0);
    const p = computeMonthlyPayment({ program: "Conventional", price: 300000, downPct: 100, term: 30, rate: 6.5, taxes: 200, insurance: 90 });
    assert.equal(p.pi, 0);
    assert.equal(p.mi, 0);
    assert.equal(p.total, 290);
    assert.ok(allFinite(p));
  });

  test("0% down is valid for VA and USDA and finances the full price plus the fee", () => {
    assert.equal(resolveProgram({ program: "VA", price: 300000, downPct: 0 }).baseLoan, 300000);
    assert.equal(resolveProgram({ program: "USDA", price: 300000, downPct: 0 }).loan, 303000); // 300,000 + 1%
  });
});

describe("amortization schedule", () => {
  test("30-year totals match the reference: $382,633 interest, paid off in month 360", () => {
    const a = generateAmortData(300000, 6.5, 30);
    assert.equal(a.totalInterest, 382633);
    assert.equal(a.payoffMonth, 360);
    assert.equal(a.data.length, 30);
  });

  test("15-year totals match the reference: $170,398 interest, paid off in month 180", () => {
    const a = generateAmortData(300000, 6.5, 15);
    assert.equal(a.totalInterest, 170398);
    assert.equal(a.payoffMonth, 180);
    assert.equal(a.data.length, 15);
  });

  test("balance falls every year and ends at zero; principal repaid adds up to the loan", () => {
    for (const [loan, rate, term] of [[300000, 6.5, 30], [300000, 6.5, 15], [450000, 3, 30], [150000, 10, 30]]) {
      const { data } = generateAmortData(loan, rate, term);
      let prev = loan;
      for (const row of data) {
        assert.ok(row.balance < prev, `balance must fall in year ${row.year}`);
        assert.ok(row.principal > 0 && row.interest >= 0);
        prev = row.balance;
      }
      assert.equal(data.at(-1).balance, 0);
      // Yearly rows are rounded to whole dollars, so allow $1 per year of rounding.
      near(data.reduce((n, r) => n + r.principal, 0), loan, term, "sum of principal");
    }
  });

  test("interest paid falls year over year on a fixed-rate loan", () => {
    const { data } = generateAmortData(300000, 6.5, 30);
    for (let i = 1; i < data.length; i++) assert.ok(data[i].interest < data[i - 1].interest);
  });
});

describe("extra payment strategies", () => {
  const base = generateAmortData(300000, 6.5, 30);

  test("no strategy, and a $0 extra, are identical to the plain schedule", () => {
    assert.deepEqual(generateAmortData(300000, 6.5, 30, { strategy: "none" }), base);
    assert.deepEqual(generateAmortData(300000, 6.5, 30, { strategy: "monthly", extraAmount: 0 }), base);
  });

  test("$200 extra a month: paid off in month 277 with $279,185 interest (reference)", () => {
    const a = generateAmortData(300000, 6.5, 30, { strategy: "monthly", extraAmount: 200 });
    assert.equal(a.payoffMonth, 277);
    assert.equal(a.totalInterest, 279185);
    near(a.monthly, base.monthly, 1e-9, "required payment is unchanged");
  });

  test("$2,400 once a year: paid off in month 279 with $282,963 interest (reference)", () => {
    const a = generateAmortData(300000, 6.5, 30, { strategy: "annual", extraAmount: 2400 });
    assert.equal(a.payoffMonth, 279);
    assert.equal(a.totalInterest, 282963);
  });

  // The calculator models bi-weekly as one extra full payment a year, spread
  // evenly across the twelve months. That modeling choice is what is pinned here.
  test("bi-weekly (one extra payment a year): month 290, $295,377 interest (reference)", () => {
    const a = generateAmortData(300000, 6.5, 30, { strategy: "biweekly" });
    assert.equal(a.payoffMonth, 290);
    assert.equal(a.totalInterest, 295377);
  });

  test("the same $2,400 a year pays off sooner monthly than as one annual lump", () => {
    const monthly = generateAmortData(300000, 6.5, 30, { strategy: "monthly", extraAmount: 200 });
    const annual = generateAmortData(300000, 6.5, 30, { strategy: "annual", extraAmount: 2400 });
    assert.ok(monthly.totalInterest < annual.totalInterest);
    assert.ok(annual.totalInterest < base.totalInterest);
  });
});

describe("mortgage insurance end date in the amortization model", () => {
  // Assumption pinned: with miDropoffType "ltv", MI stops being counted in the
  // first month whose END-of-month balance is at or below 78% of the original
  // value, using the ACTUAL balance. With no extra payments the actual and the
  // scheduled balance are the same, so this matches the HPA automatic
  // termination date (SOURCES.hpa). With extra payments they differ; see the
  // "questionable assumptions" note in the test report.
  test("5% down on $350,000 at 6.75%: PMI ends in month 139 (reference)", () => {
    const a = generateAmortData(332500, 6.75, 30, { monthlyMI: 100, miMonths: 360, homeValue: 350000, miDropoffType: "ltv" });
    assert.equal(a.miEndMonth, 139);
    assert.equal(a.miPaidTotal, 138 * 100);
  });

  test("3.5% down on $350,000 at 6.75%: PMI ends in month 145 (reference)", () => {
    const a = generateAmortData(337750, 6.75, 30, { monthlyMI: 100, miMonths: 360, homeValue: 350000, miDropoffType: "ltv" });
    assert.equal(a.miEndMonth, 145);
    assert.equal(a.miPaidTotal, 144 * 100);
  });

  test("fixed-term MI (FHA with 10% or more down) is charged for exactly 132 months", () => {
    const a = generateAmortData(300000, 6.5, 30, { monthlyMI: 100, miMonths: 132, miDropoffType: "term" });
    assert.equal(a.miPaidTotal, 132 * 100);
  });

  test("life-of-loan MI (FHA under 10% down) is charged every month of the term", () => {
    const a = generateAmortData(300000, 6.5, 30, { monthlyMI: 100, miMonths: 360, miDropoffType: "term" });
    assert.equal(a.miPaidTotal, 360 * 100);
  });

  test("extra payments never lengthen the time MI is paid", () => {
    const opts = { monthlyMI: 100, miMonths: 360, homeValue: 350000, miDropoffType: "ltv" };
    const plain = generateAmortData(332500, 6.75, 30, opts);
    const extra = generateAmortData(332500, 6.75, 30, { ...opts, strategy: "monthly", extraAmount: 300 });
    assert.ok(extra.miEndMonth <= plain.miEndMonth);
    assert.ok(extra.miPaidTotal <= plain.miPaidTotal);
  });
});

describe(`FHA rules (${SOURCES.fha})`, () => {
  test("upfront premium is 1.75% of the base loan and is financed", () => {
    // $350,000 at 3.5% down: base 337,750; 1.75% = 5,910.625; loan 343,660.625
    const t = resolveProgram({ program: "FHA", price: 350000, downPct: 3.5 });
    near(t.baseLoan, 337750, 1e-6);
    near(t.upfront, 5910.625, 1e-6);
    near(t.loan, 343660.625, 1e-6);
  });

  test("annual premium: 0.55% above 95% loan-to-value, 0.50% at or below", () => {
    assert.equal(fhaMiRate(3.5), 0.55);
    assert.equal(fhaMiRate(4.99), 0.55);
    assert.equal(fhaMiRate(5), 0.5); // exactly 95.00% LTV is not "> 95.00%"
    assert.equal(fhaMiRate(10), 0.5);
  });

  test("minimum down payment is 3.5%", () => {
    assert.equal(resolveProgram({ program: "FHA", price: 350000, downPct: 3.49 }).eligible, false);
    assert.equal(resolveProgram({ program: "FHA", price: 350000, downPct: 3.5 }).eligible, true);
  });

  test("the annual premium is charged on the base loan, not the financed total", () => {
    const p = computeMonthlyPayment({ program: "FHA", price: 350000, downPct: 3.5, term: 30, rate: 6.75 });
    near(p.mi, (337750 * 0.0055) / 12, 1e-6); // 154.80
  });
});

describe(`VA rules (${SOURCES.va})`, () => {
  // [usage, down %, expected fee %]
  const chart = [
    ["first", 0, 2.15], ["first", 4.99, 2.15], ["first", 5, 1.5], ["first", 9.99, 1.5], ["first", 10, 1.25], ["first", 25, 1.25],
    ["subsequent", 0, 3.3], ["subsequent", 4.99, 3.3], ["subsequent", 5, 1.5], ["subsequent", 9.99, 1.5], ["subsequent", 10, 1.25],
    ["exempt", 0, 0], ["exempt", 10, 0],
  ];
  for (const [usage, down, fee] of chart) {
    test(`${usage} use at ${down}% down: ${fee}% funding fee`, () => assert.equal(vaFeeRate(usage, down), fee));
  }

  test("the fee is a percentage of the loan amount, is financed, and there is no monthly MI", () => {
    // $350,000 at 3.5% down, first use: 337,750 * 2.15% = 7,261.625
    const t = resolveProgram({ program: "VA", price: 350000, downPct: 3.5, vaUsage: "first" });
    near(t.upfront, 7261.625, 1e-6);
    near(t.loan, 345011.625, 1e-6);
    assert.equal(t.miRate, 0);
    assert.equal(t.eligible, true);
  });

  test("an exempt borrower finances no fee", () => {
    const t = resolveProgram({ program: "VA", price: 350000, downPct: 0, vaUsage: "exempt" });
    assert.equal(t.upfront, 0);
    assert.equal(t.loan, 350000);
  });
});

describe(`USDA rules (${SOURCES.usda})`, () => {
  test("1.00% upfront guarantee fee, financed, and a 0.35% annual fee", () => {
    const t = resolveProgram({ program: "USDA", price: 350000, downPct: 3.5 });
    near(t.upfront, 3377.5, 1e-6); // 337,750 * 1%
    near(t.loan, 341127.5, 1e-6);
    assert.equal(t.miRate, 0.35);
    assert.equal(USDA_MI_RATE, 0.35);
  });

  test("no down payment is required", () => {
    assert.equal(resolveProgram({ program: "USDA", price: 350000, downPct: 0 }).eligible, true);
  });
});

describe("Conventional rules", () => {
  // These PMI rates are the site's published estimate (740+ credit score, under
  // 43% debt-to-income), not a regulated figure. PMI is priced by private
  // insurers and varies by borrower. The tests pin the estimate and its tier
  // boundaries so a change is deliberate.
  const tiers = [[3, 0.52], [4.99, 0.52], [5, 0.37], [9.99, 0.37], [10, 0.27], [19.99, 0.27], [20, 0], [50, 0]];
  for (const [down, rate] of tiers) {
    test(`${down}% down: estimated PMI ${rate}%`, () => assert.equal(conventionalMiRate(down), rate));
  }

  test("no upfront fee; the loan is price minus down payment", () => {
    const t = resolveProgram({ program: "Conventional", price: 350000, downPct: 5 });
    assert.equal(t.upfront, 0);
    assert.equal(t.loan, 332500);
    assert.equal(t.loan, t.baseLoan);
  });

  test("minimum down payment is 3%", () => {
    assert.equal(resolveProgram({ program: "Conventional", price: 350000, downPct: 2.99 }).eligible, false);
    assert.equal(resolveProgram({ program: "Conventional", price: 350000, downPct: 3 }).eligible, true);
  });

  test("a dollar down payment overrides the percentage for the loan amount", () => {
    const t = resolveProgram({ program: "Conventional", price: 350000, downPct: 5, downAmt: 20000 });
    assert.equal(t.down, 20000);
    assert.equal(t.baseLoan, 330000);
  });
});

describe("full monthly payment (the number the calculator shows)", () => {
  // $350,000, 3.5% down, 6.75%, 30 years. Taxes $277 and insurance $102 are the
  // whole-dollar escrow figures for 0.95% tax and 0.35% insurance.
  // P&I values are from expected_values.py; MI is base loan * rate / 12.
  const expected = {
    Conventional: { pi: 2190.64, mi: 146.36 }, // 337,750 * 0.52% / 12
    FHA: { pi: 2228.98, mi: 154.8 }, //          337,750 * 0.55% / 12, on a 343,660.63 loan
    VA: { pi: 2237.74, mi: 0 }, //               on a 345,011.63 loan
    USDA: { pi: 2212.55, mi: 98.51 }, //         337,750 * 0.35% / 12, on a 341,127.50 loan
  };
  for (const [program, e] of Object.entries(expected)) {
    test(`${program}: P&I $${e.pi}, MI $${e.mi}, total is the sum of its parts`, () => {
      const p = computeMonthlyPayment({ program, price: 350000, downPct: 3.5, term: 30, rate: 6.75, taxes: 277, insurance: 102, hoa: 50 });
      near(p.pi, e.pi, 0.005, "pi");
      near(p.mi, e.mi, 0.005, "mi");
      near(p.total, e.pi + e.mi + 277 + 102 + 50, 0.01, "total");
      near(monthlyMI(p.baseLoan, p.miRate), p.mi, 1e-9);
    });
  }

  test("escrow scales with price and rounds to whole dollars", () => {
    // 350,000 * 0.95% / 12 = 277.08 ; 350,000 * 0.35% / 12 = 102.08
    assert.deepEqual(priceScaledEscrow(350000, 0.95), { taxes: 277, insurance: 102 });
  });
});

describe("payment-first solver", () => {
  const base = { downPct: 3.5, term: 30, rate: 6.75, taxRatePct: 0.95, hoa: 50 };

  for (const program of ["Conventional", "FHA", "VA", "USDA"]) {
    test(`${program}: the solved price reproduces the target payment within $1`, () => {
      const s = solvePriceForPayment(2800, { ...base, program });
      assert.equal(s.reason, null);
      near(s.payment, 2800, 1, "solved payment");
      // Re-entering the solved price in price-first mode gives the same payment.
      const { taxes, insurance } = priceScaledEscrow(s.price, base.taxRatePct);
      const forward = computeMonthlyPayment({ program, price: s.price, downPct: 3.5, term: 30, rate: 6.75, taxes, insurance, hoa: 50 });
      near(forward.total, s.payment, 1e-9, "forward payment at the solved price");
    });
  }

  test("a higher target payment solves to a higher price", () => {
    const prices = [1500, 2500, 4000, 8000].map((t) => solvePriceForPayment(t, { ...base, program: "Conventional" }).price);
    for (let i = 1; i < prices.length; i++) assert.ok(prices[i] > prices[i - 1]);
  });

  test("a higher rate solves to a lower price for the same payment", () => {
    const low = solvePriceForPayment(2800, { ...base, rate: 5, program: "Conventional" }).price;
    const high = solvePriceForPayment(2800, { ...base, rate: 8, program: "Conventional" }).price;
    assert.ok(high < low);
  });

  test("a target below the cheapest possible payment reports belowFloor with no price", () => {
    const s = solvePriceForPayment(100, { ...base, program: "Conventional" });
    assert.equal(s.reason, "belowFloor");
    assert.equal(s.price, null);
  });

  test("a target above the cap reports aboveCap at the price ceiling", () => {
    const s = solvePriceForPayment(10000000, { ...base, program: "Conventional" });
    assert.equal(s.reason, "aboveCap");
    assert.equal(s.price, 10000000);
  });

  test("invalid targets (zero, negative, not a number) return no price instead of a guess", () => {
    for (const bad of [0, -500, NaN, undefined]) {
      const s = solvePriceForPayment(bad, { ...base, program: "Conventional" });
      assert.equal(s.price, null, `target ${bad}`);
      assert.equal(s.reason, "belowFloor");
    }
  });
});

describe("APR", () => {
  test("with no finance charges, APR equals the note rate", () => {
    assert.equal(calculateAPR(300000, 0, 6.5, 30), 6.5);
  });

  test("$6,000 of prepaid finance charges on $300,000 at 6.5%: APR 6.70% (reference 6.695)", () => {
    near(calculateAPR(300000, 6000, 6.5, 30), 6.695, 0.006);
  });

  test("adding $130 a month of MI for 100 months: APR 7.03% (reference 7.029)", () => {
    near(calculateAPR(300000, 6000, 6.5, 30, 130, 100), 7.029, 0.006);
  });

  test("APR never falls below the note rate and rises with charges and with MI", () => {
    const steps = [0, 2000, 6000, 12000].map((c) => calculateAPR(300000, c, 6.5, 30));
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i] > steps[i - 1]);
    assert.ok(steps[0] >= 6.5);
    assert.ok(calculateAPR(300000, 6000, 6.5, 30, 130, 360) > calculateAPR(300000, 6000, 6.5, 30, 130, 100));
  });

  test("inputs APR cannot be computed for fall back to the note rate, never NaN", () => {
    assert.equal(calculateAPR(0, 0, 6.5, 30), 6.5); // no loan
    assert.equal(calculateAPR(300000, 300000, 6.5, 30), 6.5); // charges swallow the loan
    assert.equal(calculateAPR(300000, 6000, 0, 30), 0); // 0% note rate: returned as is
  });
});

describe("payoff time wording", () => {
  test("formats months as years and months", () => {
    assert.equal(formatPayoff(277), "23 yr 1 mo");
    assert.equal(formatPayoff(360), "30 yr");
    assert.equal(formatPayoff(7), "7 mo");
  });
});

// Known gaps, kept visible in the test output. The pure math functions do not
// validate their own arguments; the calculator's inputs do that (the rate field
// accepts 0 to 15, price and down payment are range checked, URL parameters are
// parsed with bounds). These are not asserted because the current behavior for
// such inputs is not a contract worth locking in.
describe("invalid inputs to the pure functions (not guarded; see report)", () => {
  test.todo("generateAmortData: a non-numeric or negative rate should be rejected, not amortized");
  test.todo("generateAmortData: a zero-year term should not return an Infinity payment");
  test.todo("resolveProgram: a down payment above the price should not produce a negative loan marked eligible");
});
